/**
 * Verify the RUNNING instance over HTTP — the check the encoding rule demands
 * before claiming anything works ("start the service, open the page, confirm no
 * load failures").
 *
 * Distinct from the other tests, which boot the Host half in-process with a fake
 * context: this one talks to a live server on a real port, so it also catches
 * things an in-process test cannot — route registration on the current DSH
 * version, the same-origin guard, and what the browser half actually reports.
 *
 * It is careful with state: the probe version is added and then removed, and the
 * existing ignore list is left exactly as it was found.
 *
 *   node tests/live-verify.mjs [baseUrl]
 */
const BASE = (process.argv[2] ?? 'http://127.0.0.1:3080').replace(/\/+$/, '');
const PROBE = '0.0.0-probe';
const ORIGIN = BASE;

const problems = [];
const skipped = [];
let checks = 0;
const assert = (condition, message) => {
  checks += 1;
  if (!condition) problems.push(message);
};

async function call(path, init) {
  const response = await fetch(`${BASE}/dsh-update-lens${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body === undefined ? {} : { 'content-type': 'application/json', origin: ORIGIN }), ...init?.headers },
    signal: AbortSignal.timeout(30_000),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* leave body null */
  }
  return { status: response.status, body };
}

const status = await call('/status');
if (status.status !== 200 || status.body === null) {
  console.log(`LIVE VERIFY FAIL: GET /status returned ${status.status} at ${BASE}`);
  console.log('  (is the profile running, and is this the right port?)');
  process.exit(1);
}

const s = status.body;
console.log(`base url      : ${BASE}`);
console.log(`installed dsh : ${s.current?.version} (channel ${s.current?.channel}, via ${s.current?.source})`);
console.log(`update target : ${s.target?.version} | behind ${s.versionsBehind}`);
console.log(`notes         : available=${s.notesAvailable} source=${s.notesSourceId ?? '(none)'} cards=${Array.isArray(s.notes) ? s.notes.length : 'n/a'}`);
console.log(`sources       : ${(s.sources ?? []).map(source => `${source.id}=${source.ok ? 'ok' : source.error}(${source.via ?? '?'},${source.ms}ms)`).join('  ')}`);
console.log(`client build  : ${s.client?.rev ?? '(no page has polled yet)'}`);

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
assert(SEMVER.test(String(s.current?.version)), `installed version is not a semver: ${s.current?.version}`);
assert(s.current?.source !== 'unknown', 'the Host could not detect its own installed version');
assert(Array.isArray(s.features), 'status must advertise a features array');
assert(s.features.includes('ignore'), 'features must include "ignore" (this Host serves the route below)');
assert(Array.isArray(s.sources) && s.sources.length > 0, 'at least one source must be reported');
assert(s.sources.some(source => source.kind === 'registry' && source.ok) || skipped.push('no registry source reachable right now'), 'the version check needs a working registry source');

// The route the page's per-card button calls, exercised for real.
const before = Array.isArray(s.config?.ignoredVersions) ? s.config.ignoredVersions : [];
const added = await call('/ignore', { method: 'POST', body: JSON.stringify({ version: PROBE, ignored: true }) });
assert(added.status === 200, `POST /ignore returned ${added.status} (${JSON.stringify(added.body)})`);
if (added.status === 200) {
  const list = added.body?.config?.ignoredVersions ?? [];
  assert(list.includes(PROBE), 'the probe version should be in the ignore list after adding it');
  assert(before.every(version => list.includes(version)), 'adding a version must not disturb the existing hidden ones');
  assert(!(added.body?.status?.notes ?? []).some(note => note.version === PROBE), 'a hidden version must not appear as a card');

  const removed = await call('/ignore', { method: 'POST', body: JSON.stringify({ version: PROBE, ignored: false }) });
  assert(removed.status === 200, `removing the probe returned ${removed.status}`);
  const after = removed.body?.config?.ignoredVersions ?? [];
  assert(!after.includes(PROBE), 'the probe version must be gone after removing it');
  assert(JSON.stringify(after) === JSON.stringify(before), `the ignore list must be restored exactly: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
}

// Cross-origin writes stay refused on the live server too.
const hostile = await fetch(`${BASE}/dsh-update-lens/ignore`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
  body: JSON.stringify({ version: PROBE, ignored: true }),
  signal: AbortSignal.timeout(15_000),
});
assert(hostile.status === 403, `a cross-origin POST should be 403, got ${hostile.status}`);

console.log(`\nassertions run: ${checks}`);
if (skipped.length > 0) console.log(`environmental notes:\n - ${skipped.join('\n - ')}`);
console.log('\n' + (problems.length === 0 ? 'LIVE VERIFY PASS — the running instance serves every feature the page offers.' : `LIVE VERIFY FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
