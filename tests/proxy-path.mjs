/**
 * Proves the outbound paths actually behave as the page claims.
 *
 * The bug this locks down: a ProxyAgent from the dsh installation's undici copy
 * was handed to Node's *built-in* fetch, which rejects a foreign Dispatcher with
 * UND_ERR_INVALID_ARG — so configuring a proxy made every check fail. The fix
 * pairs the agent with undici's own fetch; these checks fail loudly if that ever
 * regresses, and they refuse to let a configured proxy silently become a direct
 * request.
 *
 * The live config file is saved and restored, so running this never changes what
 * the user has configured.
 *
 *   node tests/proxy-path.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';

import { dshHome, findCliBin } from './_env.mjs';

const CLI_BIN = findCliBin();
if (CLI_BIN === null) {
  console.log('SKIP: the dsh CLI could not be located (set DSH_CLI_BIN to point at lib/bin.js)');
  process.exit(0);
}
const CONFIG_FILE = join(dshHome(), 'dsh-update-lens', 'config.json');
const DEAD_PROXY = 'http://127.0.0.1:7999';
const LIVE_PROXY = 'http://127.0.0.1:7890';

const problems = [];
const skipped = [];
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) problems.push(message);
};

process.argv[1] = CLI_BIN;
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

function portListening(port) {
  return new Promise(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    const done = value => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

const originalConfig = existsSync(CONFIG_FILE) ? readFileSync(CONFIG_FILE, 'utf8') : null;
let liveProxyListening = false;

try {
  liveProxyListening = await portListening(7890);

  // --- 1. direct: no proxy configured -------------------------------------
  {
    const saved = await call('/config', 'POST', { proxyUrl: '' });
    assert(saved.status === 200, `direct: config save returned ${saved.status}`);
    assert(saved.json.config.proxyUrl === '', 'direct: config did not persist an empty proxy');
    assert(saved.json.status.proxy.mode === 'direct', 'direct: status must report mode=direct');

    const { json } = await call('/check', 'POST', {});
    const ok = json.sources.filter(source => source.ok);
    if (ok.length === 0) skipped.push('direct check: no source reachable right now (network down)');
    else {
      assert(ok.every(source => source.via === 'direct'), 'direct: a successful source must report via=direct');
      assert(json.proxy.mode === 'direct' && json.proxy.available === null, 'direct: proxy health must be null, not a fake value');
    }
  }

  // --- 2. a proxy that nothing is listening on ----------------------------
  {
    const saved = await call('/config', 'POST', { proxyUrl: DEAD_PROXY });
    assert(saved.status === 200, `dead proxy: config save returned ${saved.status}`);
    assert(saved.json.config.proxyUrl === DEAD_PROXY + '/', `dead proxy: normalized url was ${saved.json.config.proxyUrl}`);

    const { json } = await call('/check', 'POST', {});
    assert(json.ok === false, 'dead proxy: the check must report failure, not a fabricated result');
    assert(json.proxy.mode === 'proxy' && json.proxy.url === DEAD_PROXY + '/', 'dead proxy: status must still name the configured proxy');
    assert(json.sources.length > 0, 'dead proxy: sources must still be reported');
    // The crucial anti-regression assertion: requests really went to the proxy
    // instead of quietly succeeding by going direct.
    assert(json.sources.every(source => source.ok === false), 'dead proxy: no source may succeed while the proxy is dead');
    assert(json.sources.every(source => source.via === 'proxy'), 'dead proxy: every attempt must report via=proxy');
    assert(json.sources.some(source => /ECONNREFUSED|ECONNRESET|timeout|connection/i.test(source.error ?? '')), `dead proxy: expected a connection error, got ${JSON.stringify(json.sources.map(s => s.error))}`);
  }

  // --- 3. the real local proxy, if it is running --------------------------
  if (!liveProxyListening) {
    skipped.push('live proxy check: nothing listening on 127.0.0.1:7890');
  } else {
    await call('/config', 'POST', { proxyUrl: LIVE_PROXY });
    const { json } = await call('/check', 'POST', {});
    assert(json.proxy.mode === 'proxy' && json.proxy.available === true, `live proxy: expected an available agent, got ${JSON.stringify(json.proxy)}`);
    const ok = json.sources.filter(source => source.ok);
    if (ok.length === 0) {
      skipped.push(`live proxy check: proxy reachable but no source answered (${json.sources.map(s => `${s.id}:${s.error}`).join(', ')})`);
    } else {
      // This is the exact case that used to fail with UND_ERR_INVALID_ARG.
      assert(ok.every(source => source.via === 'proxy'), 'live proxy: success must be reported as via=proxy');
      assert(!json.sources.some(source => /UND_ERR_INVALID_ARG/.test(source.error ?? '')), 'live proxy: a foreign-dispatcher error must never come back');
      assert(json.ok === true, 'live proxy: the registry source must be usable');
    }
  }
} finally {
  // Restore exactly what the user had, whichever way we exited.
  if (originalConfig !== null) writeFileSync(CONFIG_FILE, originalConfig, 'utf8');
  else await call('/config', 'POST', { proxyUrl: '' }).catch(() => {});
}

console.log(`assertions run: ${checks}`);
if (skipped.length > 0) console.log(`environmental skips:\n - ${skipped.join('\n - ')}`);
console.log('\n' + (problems.length === 0 ? 'PROXY PATH PASS' : `PROXY PATH FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
