/**
 * Pre-install smoke test for dsh-update-lens's Host half.
 * Boots `apply()` against a fake Cordis context, captures the registered routes,
 * then drives the real handlers and prints the payload the page would receive.
 */
import { readFileSync } from 'node:fs';
import { apply } from '../index.js';

const routes = new Map();
const disposers = [];
const logs = [];

const ctx = {
  logger: {
    info: (...args) => logs.push(['info', args.join(' ')]),
    warn: (...args) => logs.push(['warn', args.join(' ')]),
  },
  effect(fn, label) {
    const disposer = fn();
    disposers.push({ label, disposer });
    return () => disposer?.();
  },
  webServer: {
    register(route) {
      const key = `${route.kind}:${route.path}`;
      if (routes.has(key)) throw new Error(`duplicate route ${key}`);
      routes.set(key, route.handler);
      return () => routes.delete(key);
    },
  },
};

apply(ctx);

console.log('--- routes registered ---');
for (const key of routes.keys()) console.log(' ', key);
console.log('--- logs ---');
for (const [level, message] of logs) console.log(` ${level}: ${message}`);

function fakeResponse() {
  return {
    status: null,
    headers: null,
    body: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(chunk) {
      if (chunk !== undefined) this.body += chunk;
    },
  };
}

function fakeRequest(method, { origin = 'http://127.0.0.1:3080', host = '127.0.0.1:3080' } = {}) {
  return { method, headers: { origin, host, 'content-type': 'application/json' } };
}

// 1. status before any check
{
  const response = fakeResponse();
  await routes.get('exact:/dsh-update-lens/status')(fakeRequest('GET'), response);
  const payload = JSON.parse(response.body);
  console.log('\n--- GET /status (cold) ---');
  console.log(' status', response.status, '| checking', payload.checking, '| neverChecked', payload.neverChecked);
  console.log(' current', payload.current?.version, 'via', payload.current?.source);
  console.log(' shape keys:', Object.keys(payload).sort().join(','));
}

// 2. cross-origin write must be refused
{
  const response = fakeResponse();
  await routes.get('exact:/dsh-update-lens/check')(fakeRequest('POST', { origin: 'http://evil.example' }), response);
  console.log('\n--- POST /check (cross-origin) ---');
  console.log(' status', response.status, '| body', response.body);
}

// 3. the real check: talks to the npm registry and GitHub
{
  const response = fakeResponse();
  const started = Date.now();
  await routes.get('exact:/dsh-update-lens/check')(fakeRequest('POST'), response);
  const payload = JSON.parse(response.body);
  console.log(`\n--- POST /check (real network, ${Date.now() - started}ms) ---`);
  console.log(' status', response.status);
  console.log(' ok', payload.ok, '| updateAvailable', payload.updateAvailable, '| versionsBehind', payload.versionsBehind);
  console.log(' current', payload.current?.version, `(${payload.current?.channel})`, 'via', payload.current?.source);
  console.log(' target ', payload.target?.version, `(${payload.target?.channel})`, 'published', payload.target?.publishedAt);
  console.log(' newest ', payload.newest?.version, '| newestSameChannel', payload.newestSameChannel);
  console.log(' dist-tags', JSON.stringify(payload.channels?.distTags));
  console.log(' downgrade tags', JSON.stringify(payload.downgradeTags));
  console.log(' newer versions', JSON.stringify(payload.newerVersions));
  console.log(' proxy policy', JSON.stringify(payload.proxy));
  console.log(' sources:');
  for (const source of payload.sources) {
    console.log(`   ${source.ok ? 'OK  ' : 'FAIL'} ${source.label.padEnd(34)} ${String(source.ms).padStart(5)}ms  ${source.error ?? ''}`);
  }
  console.log(' notesAvailable', payload.notesAvailable, '| notes entries', payload.notes?.length, '| currentRelease', payload.currentRelease?.version ?? null);
  if (payload.currentRelease?.cn) {
    console.log(' current release note (first 200 chars of zh):');
    console.log('   ' + payload.currentRelease.cn.slice(0, 200).replace(/\n/g, '\n   '));
    console.log(' annotation summary:', JSON.stringify(payload.currentRelease.summary));
    const flagged = (payload.currentRelease.cnBlocks ?? []).filter(block => block.level !== null);
    console.log(` flagged blocks (${flagged.length}):`);
    for (const block of flagged.slice(0, 6)) {
      console.log(`   ${block.level === 'breaking' ? '!!' : ' ~'} ${block.text.slice(0, 70)}  ← ${block.words.join(' / ')}`);
    }
    if (flagged.length === 0) console.log('   (none)');
  }
  console.log(' selectors:');
  for (const row of payload.selectors) console.log('   ', row.id, '=>', row.command);
}

// 4. config write + validation
{
  const response = fakeResponse();
  await routes.get('exact:/dsh-update-lens/config')(fakeRequest('POST'), response);
  console.log('\n--- POST /config with no body (should be a clean 400) ---');
  console.log(' status', response.status, '| body', response.body);
}

// 5. proxy port probe
{
  const response = fakeResponse();
  await routes.get('exact:/dsh-update-lens/proxy-probe')(fakeRequest('GET'), response);
  console.log('\n--- GET /proxy-probe ---');
  console.log(' status', response.status, '|', response.body);
}

// 6. disposal removes every route
for (const { label, disposer } of disposers) {
  if (label?.includes('routes and schedule')) disposer?.();
}
console.log('\n--- after dispose ---');
console.log(' remaining routes:', routes.size);

// keep the file honest about what it imported
console.log('\npackage.json version:', JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
