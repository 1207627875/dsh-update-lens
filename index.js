/**
 * dsh-update-lens — Host half.
 *
 * Read-only update awareness for DSH. It answers one question — "is a newer
 * official dsh than the one I am running?" — and deliberately never installs,
 * downloads or replaces anything. Updating stays a human action.
 *
 * Sources, in priority order, each reported separately in `status.sources`:
 *   1. registry.npmjs.org   version numbers (authoritative, works without a VPN)
 *   2. registry.npmmirror.com  the same data through the China mirror
 *   3. api.github.com/repos/<repo>/releases  release notes ("what changed")
 *
 * Outbound policy mirrors the shipped `@deepseek-ai/dsh-http-proxy` conventions:
 * `HTTPS_PROXY`/`https_proxy` from the launch environment is honoured first,
 * then an explicit proxy configured in this plugin's own settings, and
 * otherwise requests go direct (`fetch` ignores a broken system/WinINET proxy,
 * which is why a dead 127.0.0.1:7890 registration does not break the check).
 *
 * Routes (all under /dsh-update-lens, same-origin writes only):
 *   GET  /status        current + latest versions, notes, source health, config
 *   POST /check         run a check now
 *   POST /config        persist settings
 *   POST /dismiss       silence the notification for one version
 *   GET  /proxy-probe   which well-known local proxy ports are actually listening
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { annotateRelease } from './notes.js';

export const name = 'dsh-update-lens';
/** The route table needs the web carrier; without it this plugin has nothing to serve. */
export const inject = ['webServer'];

const ROUTE_PREFIX = '/dsh-update-lens';
const PKG = '@deepseek-ai/dsh';
const REPO = 'deepseek-ai/deepseek-harness';
const NPM_OFFICIAL = 'https://registry.npmjs.org/@deepseek-ai%2Fdsh';
const NPM_MIRROR = 'https://registry.npmmirror.com/@deepseek-ai/dsh';
const DEFAULT_GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 12_000;
/** Local proxy ports worth probing: Clash, Clash Verge, v2rayN, mixed, and common fallbacks. */
const PROXY_PORT_CANDIDATES = [7890, 7897, 7891, 10808, 10809, 1080, 8889, 8080, 20171, 2080, 33210];

const DEFAULT_CONFIG = {
  /** Master switch for the periodic check. */
  enabled: true,
  /** Minutes between automatic checks (15 min .. 7 days). */
  intervalMinutes: 360,
  /** 'follow' = only the channel the installed build came from; 'newest' = any published build. */
  channelMode: 'follow',
  /** Explicit outbound proxy for the check requests, e.g. http://127.0.0.1:7890. Empty = direct/env. */
  proxyUrl: '',
  /** Override for the release-notes endpoint (a mirror), e.g. https://my-mirror/api.github.com. */
  githubApiBase: DEFAULT_GITHUB_API,
  /** Show the in-app notification when a newer version is found. */
  notify: true,
  /** Version the user silenced the notification for. */
  dismissedVersion: '',
};

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}

function dataDir() {
  return join(dshHome(), 'dsh-update-lens');
}

function readJsonFile(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Atomic-ish write: temp file then rename, so a crash never leaves half a JSON document. */
function writeJsonFile(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    renameSync(temp, file);
    return true;
  } catch {
    return false;
  }
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const match = SEMVER_RE.exec(input.trim());
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? [] : match[4].split('.'),
  };
}

/** Standard semver ordering, prerelease-aware. Returns null when either side is unparsable. */
function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a === null || b === null) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1;
  }
  if (a.pre.length === 0 && b.pre.length === 0) return 0;
  if (a.pre.length === 0) return 1;
  if (b.pre.length === 0) return -1;
  const length = Math.max(a.pre.length, b.pre.length);
  for (let index = 0; index < length; index += 1) {
    const x = a.pre[index];
    const y = b.pre[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const dx = Number(x);
      const dy = Number(y);
      if (dx !== dy) return dx < dy ? -1 : 1;
      continue;
    }
    if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Release channel a version belongs to, by its prerelease tag. */
function channelOf(version) {
  const parsed = parseVersion(version);
  if (parsed === null) return 'unknown';
  const tag = parsed.pre[0];
  if (tag === undefined) return 'stable';
  if (tag === 'alpha' || tag === 'beta' || tag === 'rc') return tag;
  return tag;
}

/** The npm dist-tag that a channel publishes under. */
function distTagOf(channel) {
  if (channel === 'alpha') return 'alpha';
  if (channel === 'beta') return 'beta';
  if (channel === 'rc') return 'next';
  return 'latest';
}

function maxVersion(versions) {
  let best = null;
  for (const candidate of versions) {
    if (best === null || (compareVersions(candidate, best) ?? 0) > 0) best = candidate;
  }
  return best;
}

function normalizeProxyUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw === '') return { url: '', error: null };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { url: '', error: 'invalid proxy url' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: '', error: 'proxy must be an http:// or https:// url' };
  }
  return { url: parsed.toString(), error: null };
}

// ---------------------------------------------------------------------------
// which dsh am I actually running?
// ---------------------------------------------------------------------------

function packageInfoOf(file) {
  const value = readJsonFile(file);
  if (value === null || typeof value.version !== 'string') return null;
  return { version: value.version, packageName: typeof value.name === 'string' ? value.name : null, file };
}

/**
 * Resolve the running CLI package. `process.argv[1]` is the bin script of the dsh
 * that booted this profile, so walking up from it finds the exact installed version
 * (the same approach the shipped skin-market bundle uses). DSH_VERSION wins when
 * the launcher injects one.
 */
function detectRuntime() {
  const injected = typeof process.env.DSH_VERSION === 'string' ? process.env.DSH_VERSION.trim() : '';
  if (injected !== '') return { version: injected, source: 'DSH_VERSION', packageFile: null };

  const entry = typeof process.argv[1] === 'string' ? process.argv[1] : '';
  if (entry !== '') {
    let absolute = resolve(entry);
    try {
      absolute = realpathSync(absolute);
    } catch {
      /* keep the unresolved path */
    }
    let directory = dirname(absolute);
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = join(directory, 'package.json');
      if (existsSync(candidate)) {
        const info = packageInfoOf(candidate);
        if (info !== null && info.packageName === PKG) {
          return { version: info.version, source: 'cli-package', packageFile: candidate };
        }
      }
      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    try {
      const require = createRequire(absolute);
      const info = packageInfoOf(require.resolve(`${PKG}/package.json`));
      if (info !== null) return { version: info.version, source: 'module-resolution', packageFile: info.file };
    } catch {
      /* fall through to unknown */
    }
  }
  return { version: null, source: 'unknown', packageFile: null };
}

// ---------------------------------------------------------------------------
// outbound HTTP (direct, or through an explicit/environment proxy)
// ---------------------------------------------------------------------------

function describeFetchError(error) {
  if (error === null || typeof error !== 'object') return String(error);
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'timeout';
  let code = error.code ?? error.cause?.code;
  const message = error.cause?.message ?? error.message ?? String(error);
  if (code !== undefined) return String(code);
  if (/fetch failed/i.test(message)) return 'connection failed';
  return message;
}

let cachedRequire = null;
function cliRequire() {
  if (cachedRequire !== null) return cachedRequire;
  const bases = [typeof process.argv[1] === 'string' ? process.argv[1] : '', join(dataDir(), 'anchor.js')];
  for (const base of bases) {
    if (base === '') continue;
    try {
      cachedRequire = createRequire(base);
      return cachedRequire;
    } catch {
      /* try the next base */
    }
  }
  cachedRequire = createRequire(import.meta.url);
  return cachedRequire;
}

let undiciPromise = null;

/**
 * The undici copy shipped inside the dsh installation. Node's built-in fetch is
 * a *different* copy, and it rejects a foreign Dispatcher with
 * UND_ERR_INVALID_ARG — so when proxying, both the agent and the fetch have to
 * come from this one module.
 */
function loadUndici() {
  if (undiciPromise !== null) return undiciPromise;
  undiciPromise = (async () => {
    const require = cliRequire();
    const entry = require.resolve('undici');
    return await import(pathToFileURL(entry).href);
  })().catch(error => ({ loadError: describeFetchError(error) }));
  return undiciPromise;
}

const proxyAgentCache = new Map();

/**
 * Build (once per url) a ProxyAgent together with the fetch that can use it.
 * A failure is reported rather than hidden: the request falls back to direct and
 * the reason travels out on `status.proxy.note` and on each source's `note`.
 */
async function proxyEndpoint(proxyUrl) {
  if (proxyAgentCache.has(proxyUrl)) return proxyAgentCache.get(proxyUrl);
  const pending = (async () => {
    try {
      const undici = await loadUndici();
      if (undici.loadError !== undefined) return { agent: null, fetch: null, error: `undici unavailable: ${undici.loadError}` };
      const Agent = undici.ProxyAgent;
      if (typeof Agent !== 'function') return { agent: null, fetch: null, error: 'undici has no ProxyAgent export' };
      if (typeof undici.fetch !== 'function') return { agent: null, fetch: null, error: 'undici has no fetch export' };
      return { agent: new Agent(proxyUrl), fetch: undici.fetch, error: null };
    } catch (error) {
      return { agent: null, fetch: null, error: `proxy agent unavailable: ${describeFetchError(error)}` };
    }
  })();
  proxyAgentCache.set(proxyUrl, pending);
  return pending;
}

/** Resolve the effective outbound policy: explicit config, else the launch environment. */
function resolveProxyPolicy(config) {
  const configured = normalizeProxyUrl(config.proxyUrl);
  if (configured.url !== '') return { mode: 'proxy', url: configured.url, source: 'settings', error: configured.error };
  const fromEnv = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? '';
  const envProxy = normalizeProxyUrl(fromEnv);
  if (envProxy.url !== '') return { mode: 'proxy', url: envProxy.url, source: 'environment', error: null };
  if (configured.error !== null) return { mode: 'direct', url: '', source: 'fallback', error: configured.error };
  return { mode: 'direct', url: '', source: 'default', error: null };
}

async function fetchJson(url, policy) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const init = {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'dsh-update-lens', accept: 'application/json' },
    };
    let note = null;
    let via = 'direct';
    let send = fetch;
    if (policy.mode === 'proxy' && policy.url !== '') {
      const endpoint = await proxyEndpoint(policy.url);
      if (endpoint.agent !== null) {
        init.dispatcher = endpoint.agent;
        send = endpoint.fetch;
        via = 'proxy';
      } else {
        // Never pretend a configured proxy was used.
        note = `${endpoint.error} (fell back to a direct request)`;
      }
    }
    const response = await send(url, init);
    const text = await response.text();
    if (!response.ok) {
      return { ok: false, status: response.status, ms: Date.now() - started, error: `HTTP ${response.status}`, body: null, note, via };
    }
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, status: response.status, ms: Date.now() - started, error: 'invalid JSON payload', body: null, note, via };
    }
    return { ok: true, status: response.status, ms: Date.now() - started, error: null, body, note, via };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, error: describeFetchError(error), body: null, note: null, via: policy.mode === 'proxy' ? 'proxy' : 'direct' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// sources
// ---------------------------------------------------------------------------

function readNpmPayload(body) {
  if (body === null || typeof body !== 'object') return null;
  const versions = body.versions !== null && typeof body.versions === 'object' ? Object.keys(body.versions) : [];
  const published = versions
    .map(version => ({ version, at: typeof body.time?.[version] === 'string' ? body.time[version] : null }))
    .filter(entry => parseVersion(entry.version) !== null);
  if (published.length === 0) return null;
  const distTags = {};
  if (body['dist-tags'] !== null && typeof body['dist-tags'] === 'object') {
    for (const [tag, version] of Object.entries(body['dist-tags'])) {
      if (typeof version === 'string') distTags[tag] = version;
    }
  }
  return { versions: published, distTags };
}

async function probeNpm(id, label, url, policy) {
  const result = await fetchJson(url, policy);
  const base = { id, label, url, kind: 'registry', ok: result.ok, status: result.status, ms: result.ms, error: result.error, note: result.note, via: result.via };
  if (!result.ok) return { source: base, data: null };
  const data = readNpmPayload(result.body);
  if (data === null) return { source: { ...base, ok: false, error: 'no versions in payload' }, data: null };
  return { source: base, data };
}

function readReleasePayload(body) {
  if (!Array.isArray(body)) return [];
  return body.flatMap(entry => {
    if (entry === null || typeof entry !== 'object') return [];
    const tag = typeof entry.tag_name === 'string' ? entry.tag_name : '';
    const version = tag.replace(/^dsh-v/, '').replace(/^v/, '');
    if (parseVersion(version) === null) return [];
    return [{
      version,
      tag,
      name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : tag,
      publishedAt: typeof entry.published_at === 'string' ? entry.published_at : null,
      url: typeof entry.html_url === 'string' ? entry.html_url : null,
      prerelease: entry.prerelease === true,
      body: typeof entry.body === 'string' ? entry.body : '',
    }];
  });
}

/** The release body is bilingual with `<h3 id="cn-…">` / `<h3 id="en-…">` markers. */
function splitReleaseBody(body) {
  if (typeof body !== 'string' || body === '') return { cn: '', en: '' };
  const marker = body.search(/<h3 id="en-/);
  const cn = marker >= 0 ? body.slice(0, marker) : body;
  const en = marker >= 0 ? body.slice(marker) : '';
  return { cn: cleanNotes(cn), en: cleanNotes(en) };
}

function cleanNotes(text) {
  return text
    .split('\n')
    .filter(line => !/^\[[^\]]*\]\(#/.test(line.trim()))
    .join('\n')
    .replace(/<h3 id="(?:cn|en)-[^"]*">/g, '')
    .replace(/<\/h3>/g, '')
    .trim()
    .slice(0, 24_000);
}

async function probeGithub(base, policy) {
  const origin = (() => {
    try {
      return new URL(base).toString().replace(/\/+$/, '');
    } catch {
      return DEFAULT_GITHUB_API;
    }
  })();
  const url = `${origin}/repos/${REPO}/releases?per_page=20`;
  const result = await fetchJson(url, policy);
  const source = {
    id: 'github-releases',
    label: 'GitHub Releases',
    url,
    kind: 'notes',
    ok: result.ok,
    status: result.status,
    ms: result.ms,
    error: result.error,
    note: result.note,
    via: result.via,
  };
  if (!result.ok) return { source, releases: [] };
  const releases = readReleasePayload(result.body);
  if (releases.length === 0) return { source: { ...source, ok: false, error: 'no releases in payload' }, releases: [] };
  return { source, releases };
}

// ---------------------------------------------------------------------------
// the check itself
// ---------------------------------------------------------------------------

function publicConfig(config) {
  return {
    enabled: config.enabled,
    intervalMinutes: config.intervalMinutes,
    channelMode: config.channelMode,
    proxyUrl: config.proxyUrl,
    githubApiBase: config.githubApiBase,
    notify: config.notify,
    dismissedVersion: config.dismissedVersion,
  };
}

function createChecker(logger) {
  const runtime = detectRuntime();
  const configFile = join(dataDir(), 'config.json');
  const stateFile = join(dataDir(), 'state.json');

  const stored = readJsonFile(configFile);
  const config = { ...DEFAULT_CONFIG };
  if (stored !== null && typeof stored === 'object') {
    for (const key of Object.keys(DEFAULT_CONFIG)) {
      if (stored[key] !== undefined && typeof stored[key] === typeof DEFAULT_CONFIG[key]) config[key] = stored[key];
    }
  }

  const persisted = readJsonFile(stateFile);
  let snapshot = persisted !== null && typeof persisted === 'object' ? persisted : null;
  let inFlight = null;
  /**
   * The browser build that last polled. The client bundle is served with a
   * content+mtime hash, so a page can keep running an older generation after a
   * rebuild without anything failing loudly; this makes that state visible.
   */
  let lastClient = null;
  /** Outbound policy of the most recent check, so the page can show its health. */
  let proxyState = null;

  /** The policy in force *now*, carrying the last check's health when it still applies. */
  function proxyView() {
    const now = resolveProxyPolicy(config);
    if (proxyState !== null && proxyState.mode === now.mode && proxyState.url === now.url) return proxyState;
    return { mode: now.mode, url: now.url, source: now.source, error: now.error, available: null, pending: true };
  }

  async function runCheck(trigger) {
    if (inFlight !== null) return inFlight;
    inFlight = (async () => {
      const startedAt = new Date().toISOString();
      const policy = resolveProxyPolicy(config);
      const sources = [];

      // Resolve the proxy once for the whole check: whether it is usable is a
      // property of the check, not of each individual request.
      if (policy.mode === 'proxy' && policy.url !== '') {
        const endpoint = await proxyEndpoint(policy.url);
        proxyState = {
          mode: 'proxy',
          url: policy.url,
          source: policy.source,
          available: endpoint.agent !== null,
          error: endpoint.error,
        };
      } else {
        proxyState = { mode: 'direct', url: '', source: policy.source, available: null, error: policy.error };
      }

      // Official registry first (authoritative), mirror only if it fails.
      const official = await probeNpm('npm-official', 'npm registry (official)', NPM_OFFICIAL, policy);
      sources.push(official.source);
      let registry = official.data;
      if (registry === null) {
        const mirror = await probeNpm('npm-mirror', 'npm registry (npmmirror mirror)', NPM_MIRROR, policy);
        sources.push(mirror.source);
        registry = mirror.data;
      }

      const github = await probeGithub(config.githubApiBase, policy);
      sources.push(github.source);

      const result = buildStatus({
        policy: proxyState,
        registry,
        sources,
        releases: github.releases,
        checkedAt: startedAt,
        trigger,
      });
      snapshot = JSON.parse(JSON.stringify({ ...result, checking: false }));
      writeJsonFile(stateFile, snapshot);
      return snapshot;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  function buildStatus({ policy, registry, sources, releases, checkedAt, trigger }) {
    const current = runtime.version;
    const currentChannel = current === null ? 'unknown' : channelOf(current);
    const publishedVersions = registry === null ? [] : registry.versions.map(entry => entry.version);
    const publishedAt = new Map(registry === null ? [] : registry.versions.map(entry => [entry.version, entry.at]));
    const distTags = registry === null ? {} : registry.distTags;

    const newest = maxVersion(publishedVersions);
    const sameChannel = publishedVersions.filter(version => channelOf(version) === currentChannel);
    const newestSameChannel = maxVersion(sameChannel);

    const mode = config.channelMode === 'newest' ? 'newest' : 'follow';
    const target = mode === 'follow' ? (newestSameChannel ?? newest) : newest;
    const comparison = current === null || target === null ? null : compareVersions(target, current);
    const updateAvailable = comparison !== null && comparison > 0;

    // Versions between the installed one and the target, newest first — what "what changed" covers.
    const newerVersions = current === null
      ? []
      : publishedVersions
        .filter(version => (compareVersions(version, current) ?? 0) > 0)
        .sort((a, b) => (compareVersions(b, a) ?? 0))
        .slice(0, 8);

    const byVersion = new Map(releases.map(release => [release.version, release]));
    const notes = newerVersions.map(version => {
      const release = byVersion.get(version);
      const split = release === undefined ? { cn: '', en: '' } : splitReleaseBody(release.body);
      return {
        version,
        publishedAt: publishedAt.get(version) ?? release?.publishedAt ?? null,
        url: release?.url ?? `https://github.com/${REPO}/releases/tag/dsh-v${version}`,
        released: release !== undefined,
        cn: split.cn,
        en: split.en,
        ...annotateRelease(split.cn, split.en),
      };
    });

    // A dist-tag that points below the installed build: `npm i -g @deepseek-ai/dsh` would downgrade.
    const downgradeTags = current === null
      ? []
      : Object.entries(distTags)
        .filter(([, version]) => (compareVersions(version, current) ?? 0) < 0)
        .map(([tag, version]) => ({ tag, version }));

    const notesSource = sources.find(source => source.kind === 'notes');
    const registryOk = sources.some(source => source.kind === 'registry' && source.ok);

    // The release note of the build actually running, so the page can answer
    // "what am I on?" as well as "what is newer?".
    const currentRelease = (() => {
      if (current === null) return null;
      const release = byVersion.get(current);
      if (release === undefined) return null;
      const split = splitReleaseBody(release.body);
      return {
        version: current,
        publishedAt: release.publishedAt ?? publishedAt.get(current) ?? null,
        url: release.url,
        cn: split.cn,
        en: split.en,
        ...annotateRelease(split.cn, split.en),
      };
    })();

    return {
      ok: registryOk,
      checking: false,
      checkedAt,
      trigger,
      current: { version: current, channel: currentChannel, source: runtime.source, packageFile: runtime.packageFile },
      target: {
        version: target,
        channel: target === null ? null : channelOf(target),
        publishedAt: target === null ? null : publishedAt.get(target) ?? null,
        distTag: distTagOf(target === null ? currentChannel : channelOf(target)),
      },
      newest: { version: newest, channel: newest === null ? null : channelOf(newest), publishedAt: newest === null ? null : publishedAt.get(newest) ?? null },
      newestSameChannel,
      mode,
      updateAvailable,
      versionsBehind: newerVersions.length,
      newerVersions,
      notes,
      currentRelease,
      notesAvailable: notesSource?.ok === true,
      channels: {
        current: currentChannel,
        distTags,
        publishedCount: publishedVersions.length,
      },
      downgradeTags,
      selectors: buildSelectors({ current, target, mode }),
      sources,
      proxy: {
        mode: policy.mode,
        url: policy.url,
        source: policy.source,
        available: policy.available ?? null,
        error: policy.error ?? policy.note ?? null,
        note: policy.error ?? policy.note ?? null,
      },
      config: publicConfig(config),
      runtime: { node: process.version, platform: process.platform, dshHome: dshHome() },
      error: registryOk ? null : 'every package registry source failed',
    };
  }

  /** Exact commands the user runs by hand — this plugin never executes them. */
  function buildSelectors({ current, target, mode }) {
    const rows = [];
    if (target !== null) {
      rows.push({
        id: 'exact',
        command: `npm install -g ${PKG}@${target}`,
        noteKey: 'cmdExactly',
      });
    }
    const tag = distTagOf(mode === 'newest' ? channelOf(target ?? '') : channelOf(current ?? ''));
    rows.push({
      id: 'channel',
      command: `npm install -g ${PKG}@${tag}`,
      noteKey: 'cmdChannel',
    });
    rows.push({ id: 'bare', command: `npm install -g ${PKG}`, noteKey: 'cmdBare' });
    return rows;
  }

  return {
    runtime,
    config,
    configFile,
    stateFile,
    runCheck,
    /** Remember which client generation is on screen; returns the record. */
    noteClient(rev) {
      if (typeof rev !== 'string' || rev === '' || rev.length > 64) return lastClient;
      if (lastClient === null || lastClient.rev !== rev) {
        lastClient = { rev, at: new Date().toISOString() };
      } else {
        lastClient = { rev, at: lastClient.at, seenLateAt: new Date().toISOString() };
      }
      return lastClient;
    },
    clientInfo() {
      return lastClient;
    },
    status() {
      // One shape for every branch: the client never has to defend against a
      // half-built payload while the first check is still running. `config` and
      // `proxy` are always the LIVE values — a stale snapshot must not make the
      // settings form snap back to a value the user just changed.
      const live = { config: publicConfig(config), proxy: proxyView() };
      if (snapshot === null) {
        return {
          ...buildStatus({
            policy: live.proxy,
            registry: null,
            sources: [],
            releases: [],
            checkedAt: null,
            trigger: null,
          }),
          ...live,
          neverChecked: true,
        };
      }
      if (inFlight !== null) return { ...snapshot, ...live, checking: true };
      return { ...snapshot, ...live, checking: false };
    },
    updateConfig(patch) {
      const next = { ...config };
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.notify === 'boolean') next.notify = patch.notify;
      if (patch.intervalMinutes !== undefined) {
        const value = Number(patch.intervalMinutes);
        if (!Number.isFinite(value)) throw new Error('intervalMinutes must be a number');
        next.intervalMinutes = Math.min(10_080, Math.max(15, Math.round(value)));
      }
      if (patch.channelMode === 'follow' || patch.channelMode === 'newest') next.channelMode = patch.channelMode;
      if (patch.proxyUrl !== undefined) {
        const { url, error } = normalizeProxyUrl(patch.proxyUrl);
        if (error !== null) throw new Error(error);
        next.proxyUrl = url;
      }
      if (patch.githubApiBase !== undefined) {
        const raw = String(patch.githubApiBase).trim();
        if (raw === '') next.githubApiBase = DEFAULT_GITHUB_API;
        else {
          try {
            const parsed = new URL(raw);
            if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('scheme');
            next.githubApiBase = raw.replace(/\/+$/, '');
          } catch {
            throw new Error('githubApiBase must be an http(s) url');
          }
        }
      }
      if (typeof patch.dismissedVersion === 'string') next.dismissedVersion = patch.dismissedVersion.slice(0, 64);
      Object.assign(config, next);
      const saved = writeJsonFile(configFile, config);
      if (!saved) logger.warn('could not persist %s', configFile);
      return config;
    },
  };
}

// ---------------------------------------------------------------------------
// route plumbing (same conventions as the shipped bundles)
// ---------------------------------------------------------------------------

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(body);
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (typeof origin !== 'string' || typeof host !== 'string') return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

function methodGuard(request, response, expected) {
  if (request.method === expected) return true;
  response.writeHead(405, { allow: expected });
  response.end();
  return false;
}

async function readJsonBody(request, limit = 16_384) {
  try {
    if (typeof request[Symbol.asyncIterator] !== 'function') throw new Error('unreadable request stream');
    if (!String(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
      throw new Error('content-type must be application/json');
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) throw new Error('request body too large');
      chunks.push(buffer);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid request body');
    return body;
  } catch (error) {
    // Never echo a parser/stream internal back to the caller.
    const message = error instanceof Error ? error.message : '';
    const known = ['unreadable request stream', 'content-type must be application/json', 'request body too large', 'invalid request body'];
    throw new Error(known.includes(message) ? message : 'invalid request body');
  }
}

/** Which well-known local proxy ports are actually accepting connections right now. */
function probeLocalPorts() {
  const attempts = PROXY_PORT_CANDIDATES.map(port => new Promise(resolvePort => {
    const socket = connect({ host: '127.0.0.1', port });
    const finish = listening => {
      socket.removeAllListeners();
      socket.destroy();
      resolvePort({ port, url: `http://127.0.0.1:${port}`, listening });
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  }));
  return Promise.all(attempts).then(rows => rows.filter(row => row.listening));
}

// ---------------------------------------------------------------------------
// plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx) {
  const logger = ctx.logger ?? console;
  const checker = createChecker(logger);

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/status`,
        handler: (request, response) => {
          if (!methodGuard(request, response, 'GET')) return;
          const rev = new URL(request.url ?? '/', 'http://localhost').searchParams.get('client');
          if (rev !== null) checker.noteClient(rev);
          sendJson(response, 200, { ...checker.status(), client: checker.clientInfo() });
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/check`,
        handler: async (request, response) => {
          if (!methodGuard(request, response, 'POST')) return;
          if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin request required' });
          const rev = new URL(request.url ?? '/', 'http://localhost').searchParams.get('client');
          if (rev !== null) checker.noteClient(rev);
          try {
            sendJson(response, 200, { ...(await checker.runCheck('manual')), client: checker.clientInfo() });
          } catch (error) {
            sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/config`,
        handler: async (request, response) => {
          if (!methodGuard(request, response, 'POST')) return;
          if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin request required' });
          try {
            const patch = await readJsonBody(request);
            checker.updateConfig(patch);
            sendJson(response, 200, { config: publicConfig(checker.config), status: checker.status() });
          } catch (error) {
            sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/dismiss`,
        handler: async (request, response) => {
          if (!methodGuard(request, response, 'POST')) return;
          if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin request required' });
          try {
            const body = await readJsonBody(request);
            checker.updateConfig({ dismissedVersion: typeof body.version === 'string' ? body.version : '' });
            sendJson(response, 200, { config: publicConfig(checker.config) });
          } catch (error) {
            sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      ctx.webServer.register({
        kind: 'exact',
        path: `${ROUTE_PREFIX}/proxy-probe`,
        handler: async (request, response) => {
          if (!methodGuard(request, response, 'GET')) return;
          try {
            sendJson(response, 200, { candidates: await probeLocalPorts() });
          } catch (error) {
            sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
          }
        },
      }),
      ...scheduleChecks(ctx, checker),
    ];
    return () => {
      for (const dispose of disposers) {
        try {
          dispose();
        } catch {
          /* a route already gone is not an error */
        }
      }
    };
  }, 'dsh-update-lens: routes and schedule');

  logger.info(
    `dsh-update-lens ready — installed dsh ${checker.runtime.version ?? 'unknown'} (via ${checker.runtime.source}), data at ${dataDir()}`,
  );
}

/** First check shortly after boot (never blocking it), then on the configured interval. */
function scheduleChecks(ctx, checker) {
  const disposers = [];
  let timer = null;
  let disposed = false;

  const arm = delayMs => {
    timer = setTimeout(tick, delayMs);
    if (typeof timer.unref === 'function') timer.unref();
  };

  const tick = () => {
    if (disposed) return;
    const intervalMs = Math.max(15, checker.config.intervalMinutes) * 60_000;
    if (!checker.config.enabled) {
      arm(intervalMs);
      return;
    }
    checker.runCheck('scheduled')
      .catch(error => ctx.logger?.warn?.(`dsh-update-lens check failed: ${error?.message ?? error}`))
      .finally(() => arm(intervalMs));
  };

  arm(8_000);
  disposers.push(() => {
    disposed = true;
    if (timer !== null) clearTimeout(timer);
  });
  return disposers;
}
