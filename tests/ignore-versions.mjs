/**
 * Per-version "ignore" behaviour: hiding one release-notes card must not disturb
 * the facts, must persist, must be reversible, and ignoring the version you would
 * actually upgrade to must also silence its notification (otherwise the toast
 * keeps coming back and the button looks broken).
 *
 * The live config file is saved and restored, so running this never changes what
 * the user has configured.
 *
 *   node tests/ignore-versions.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dshHome, findCliBin } from './_env.mjs';

const CLI_BIN = findCliBin();
if (CLI_BIN === null) {
  console.log('SKIP: the dsh CLI could not be located (set DSH_CLI_BIN to point at lib/bin.js)');
  process.exit(0);
}
process.argv[1] = CLI_BIN;

const CONFIG_FILE = join(dshHome(), 'dsh-update-lens', 'config.json');
const originalConfig = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8') : null;

const { apply } = await import('../index.js');

const routes = new Map();
const ctx = {
  logger: { info: () => {}, warn: () => {} },
  effect: fn => {
    fn();
    return () => {};
  },
  webServer: {
    register(route) {
      routes.set(`${route.kind}:${route.path}`, route.handler);
      return () => {};
    },
  },
};
apply(ctx);

function fakeResponse() {
  return {
    status: null,
    body: '',
    writeHead(status) {
      this.status = status;
    },
    end(chunk) {
      if (chunk !== undefined) this.body += chunk;
    },
  };
}

function fakeRequest(method, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    url: '/dsh-update-lens/x',
    headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      if (text !== '') yield Buffer.from(text, 'utf8');
    },
  };
}

async function call(path, method = 'GET', body) {
  const response = fakeResponse();
  const handler = routes.get(`exact:/dsh-update-lens${path}`);
  if (handler === undefined) throw new Error(`route missing: ${path}`);
  await handler(fakeRequest(method, body), response);
  return { status: response.status, json: response.body === '' ? null : JSON.parse(response.body) };
}

const problems = [];
const checks = [];
const assert = (condition, message) => {
  checks.push(message);
  if (!condition) problems.push(message);
};

try {
  // A real check gives us a genuine version list to hide things from.
  const check = await call('/check', 'POST', {});
  assert(check.status === 200, `POST /check returned ${check.status}`);
  const status = check.json;
  const behind = Array.isArray(status.newerVersions) ? status.newerVersions : [];
  const visible = Array.isArray(status.notes) ? status.notes.map(note => note.version) : [];
  assert(behind.length === visible.length, 'with nothing ignored, every newer version should have a card');

  // Cross-origin writes must still be refused on the new route.
  const hostile = fakeResponse();
  await routes.get('exact:/dsh-update-lens/ignore')(
    { method: 'POST', url: '/x', headers: { origin: 'http://evil.example', host: '127.0.0.1:3080', 'content-type': 'application/json' }, async *[Symbol.asyncIterator]() {} },
    hostile,
  );
  assert(hostile.status === 403, `cross-origin POST /ignore should be 403, got ${hostile.status}`);

  // A missing version must be rejected, not silently stored.
  const empty = await call('/ignore', 'POST', {});
  assert(empty.status === 400, `POST /ignore without a version should be 400, got ${empty.status}`);

  if (behind.length === 0) {
    console.log('note: this install is up to date, so the hide/restore round trip has no version to exercise');
  } else {
    const victim = behind[0];
    const ignored = await call('/ignore', 'POST', { version: victim, ignored: true });
    assert(ignored.status === 200, `POST /ignore returned ${ignored.status}`);
    const after = ignored.json.status;
    assert(!after.notes.some(note => note.version === victim), 'the ignored version must lose its card');
    assert(after.versionsBehind === status.versionsBehind, 'ignoring must not change how many versions behind you are');
    assert(after.updateAvailable === status.updateAvailable, 'ignoring must not change whether an update exists');
    assert(Array.isArray(after.ignoredVersions) && after.ignoredVersions.includes(victim), 'the ignored version must be reported back for restore');
    assert(ignored.json.config.ignoredVersions.includes(victim), 'the ignored version must be in the persisted config');

    // Ignoring the update target also silences its notification.
    if (after.target?.version === victim) {
      assert(after.config.dismissedVersion === victim, 'ignoring the update target should also silence its notification');
    }

    // Persisted, not just in memory.
    const onDisk = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    assert(onDisk.ignoredVersions.includes(victim), 'the ignored list must be written to config.json');

    // Restore one.
    const restored = await call('/ignore', 'POST', { version: victim, ignored: false });
    assert(restored.json.status.notes.some(note => note.version === victim), 'restoring must bring the card back');
    assert(!restored.json.config.ignoredVersions.includes(victim), 'restoring must clear it from the config');

    // Restore all, from several hidden at once.
    await call('/ignore', 'POST', { version: behind[0], ignored: true });
    if (behind.length > 1) await call('/ignore', 'POST', { version: behind[1], ignored: true });
    const beforeAll = (await call('/status')).json;
    assert(beforeAll.ignoredVersions.length >= 1, 'at least one version should be hidden before restoreAll');
    const all = await call('/ignore', 'POST', { restoreAll: true });
    assert(all.status === 200, `restoreAll returned ${all.status}`);
    assert(all.json.config.ignoredVersions.length === 0, 'restoreAll must empty the list');
    assert(all.json.status.notes.length === visible.length, 'restoreAll must bring every card back');

    // Input handling: a non-array is rejected, junk inside an array is dropped.
    const notAnArray = await call('/config', 'POST', { ignoredVersions: 'nope' });
    assert(notAnArray.status === 400, `a non-array ignoredVersions should be 400, got ${notAnArray.status}`);
    const junk = await call('/config', 'POST', { ignoredVersions: [42, 'v1', 'v1', null, ''] });
    assert(junk.status === 200, `an array with junk entries should be accepted and sanitised, got ${junk.status}`);
    assert(JSON.stringify(junk.json.config.ignoredVersions) === '["v1"]',
      `sanitiser should keep only unique non-empty strings, got ${JSON.stringify(junk.json.config.ignoredVersions)}`);
    await call('/ignore', 'POST', { restoreAll: true });
  }

  // A config file loaded from disk is untrusted input too: apply() again so a
  // fresh checker reads it, exactly as a restart would.
  {
    const junkConfig = {
      enabled: true,
      intervalMinutes: 360,
      channelMode: 'follow',
      proxyUrl: '',
      githubApiBase: 'https://api.github.com',
      notify: true,
      dismissedVersion: '',
      ignoredVersions: [1, null, '', 'v9.9.9', 'y'.repeat(200), 'v9.9.9'],
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(junkConfig, null, 2), 'utf8');
    const secondRoutes = new Map();
    const secondCtx = {
      logger: { info: () => {}, warn: () => {} },
      effect: fn => {
        fn();
        return () => {};
      },
      webServer: {
        register(route) {
          secondRoutes.set(`${route.kind}:${route.path}`, route.handler);
          return () => {};
        },
      },
    };
    apply(secondCtx);
    const response = fakeResponse();
    await secondRoutes.get('exact:/dsh-update-lens/status')(fakeRequest('GET'), response);
    const loaded = JSON.parse(response.body).config.ignoredVersions;
    assert(Array.isArray(loaded) && loaded.length === 1 && loaded[0] === 'v9.9.9',
      `a config file with junk should load as clean strings, got ${JSON.stringify(loaded)}`);
    assert(loaded.every(entry => typeof entry === 'string' && entry.length <= 64), 'loaded entries must be short strings');
  }
} finally {
  if (originalConfig !== null) writeFileSync(CONFIG_FILE, originalConfig, 'utf8');
}

console.log(`assertions run: ${checks.length}`);
console.log('\n' + (problems.length === 0 ? 'IGNORE VERSIONS PASS' : `IGNORE VERSIONS FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
