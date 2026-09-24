/**
 * "Release notes must not depend on GitHub."
 *
 * Points the GitHub base at a dead address so the API path cannot succeed, then
 * checks that the notes still arrive through the ungh.cc mirror — and that the
 * page can tell which source produced them. Also verifies the capability flag the
 * browser half gates on, because a client that hot-reloads ahead of its Host must
 * not offer a button the Host cannot serve.
 *
 * The live config file is saved and restored.
 *
 *   node tests/notes-fallback.mjs
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
  await routes.get(`exact:/dsh-update-lens${path}`)(fakeRequest(method, body), response);
  return { status: response.status, json: response.body === '' ? null : JSON.parse(response.body) };
}

const problems = [];
const skipped = [];
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) problems.push(message);
};

try {
  // A port nothing listens on: the GitHub path is guaranteed to fail.
  const dead = await call('/config', 'POST', { githubApiBase: 'http://127.0.0.1:9' });
  assert(dead.status === 200, `setting a dead GitHub base returned ${dead.status}`);

  const { json } = await call('/check', 'POST', {});
  const github = json.sources.find(source => source.id === 'github-releases');
  const ungh = json.sources.find(source => source.id === 'ungh-cc');
  assert(github !== undefined && github.ok === false, 'the GitHub source should have failed against a dead address');
  assert(ungh !== undefined, 'the mirror should have been tried when GitHub produced nothing');

  if (ungh === undefined || ungh.ok !== true) {
    skipped.push(`mirror unreachable right now (${ungh?.error ?? 'not tried'}) — fallback could not be exercised`);
  } else {
    assert(json.notesAvailable === true, 'notes must still be available when only the mirror works');
    assert(json.notesSourceId === 'ungh-cc', `the page must be told the bodies came from the mirror, got ${json.notesSourceId}`);
    assert(Array.isArray(json.newerVersions) && json.newerVersions.length > 0, 'expected newer versions to compare against');
    assert(json.notes.length === json.newerVersions.length, 'every newer version should have a note from the mirror');

    const withBody = json.notes.filter(note => typeof note.cn === 'string' && note.cn.length > 100);
    assert(withBody.length > 0, 'mirror bodies should be non-trivial');
    if (withBody.length > 0) {
      const note = withBody[0];
      assert(/新增功能|体验优化|问题修复|其他变更/.test(note.cn), `mirror body should carry the Chinese sections, got: ${note.cn.slice(0, 60)}`);
      assert(typeof note.en === 'string' && note.en.length > 100, 'mirror body should carry the English block too');
      assert(Array.isArray(note.cnBlocks) && note.cnBlocks.length > 0, 'mirror bodies must run through the same annotator');
      assert(typeof note.summary?.breaking === 'number', 'mirror bodies must produce an annotation summary');
      assert(typeof note.url === 'string' && note.url.startsWith('https://github.com/'), `mirror notes need a canonical release URL, got ${note.url}`);
    }

    // The mirror must not be consulted when GitHub works — that is the whole
    // point of it being a fallback rather than a second dependency.
    const restored = await call('/config', 'POST', { githubApiBase: 'https://api.github.com' });
    assert(restored.status === 200, `restoring the GitHub base returned ${restored.status}`);
    const direct = await call('/check', 'POST', {});
    const mirrorAgain = direct.json.sources.find(source => source.id === 'ungh-cc');
    if (direct.json.sources.find(source => source.id === 'github-releases')?.ok === true) {
      assert(mirrorAgain === undefined, 'the mirror must not be queried when GitHub already answered');
      assert(direct.json.notesSourceId === 'github-releases', `notes source should be GitHub, got ${direct.json.notesSourceId}`);
    } else {
      skipped.push('GitHub unreachable from here, so the "mirror not queried when GitHub works" assertion was skipped');
    }
  }

  // Capability advertisement: this is what the page gates its buttons on.
  assert(Array.isArray(json.features), 'status must advertise a features array');
  assert(json.features.includes('ignore'), 'status.features must include "ignore" once the Host serves that route');
  const ignoreRoute = routes.get('exact:/dsh-update-lens/ignore');
  assert(typeof ignoreRoute === 'function', 'the advertised capability must actually exist as a route');
} finally {
  if (originalConfig !== null) writeFileSync(CONFIG_FILE, originalConfig, 'utf8');
}

console.log(`assertions run: ${checks}`);
if (skipped.length > 0) console.log(`environmental skips:\n - ${skipped.join('\n - ')}`);
console.log('\n' + (problems.length === 0 ? 'NOTES FALLBACK PASS' : `NOTES FALLBACK FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
