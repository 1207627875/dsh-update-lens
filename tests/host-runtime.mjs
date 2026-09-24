/**
 * Verifies the piece the first smoke test could not: version detection when
 * `process.argv[1]` really is the running dsh CLI (as it is inside the Host).
 */
import { findCliBin } from './_env.mjs';
import { apply } from '../index.js';

const CLI_BIN = findCliBin();
if (CLI_BIN === null) {
  console.log('SKIP: the dsh CLI could not be located (set DSH_CLI_BIN to point at lib/bin.js)');
  process.exit(0);
}
process.argv[1] = CLI_BIN;

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

function response() {
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
const request = { method: 'POST', headers: { origin: 'http://127.0.0.1:3080', host: '127.0.0.1:3080', 'content-type': 'application/json' } };

const res = response();
await routes.get('exact:/dsh-update-lens/check')(request, res);
const s = JSON.parse(res.body);

console.log('argv[1] simulated :', process.argv[1]);
console.log('current           :', s.current.version, `| channel=${s.current.channel} | source=${s.current.source}`);
console.log('packageFile       :', s.current.packageFile);
console.log('target            :', s.target.version, `| channel=${s.target.channel} | distTag=${s.target.distTag}`);
console.log('newest            :', s.newest.version, '| newestSameChannel:', s.newestSameChannel);
console.log('updateAvailable   :', s.updateAvailable, '| versionsBehind:', s.versionsBehind);
console.log('mode              :', s.mode);
console.log('downgradeTags     :', JSON.stringify(s.downgradeTags));
console.log('currentRelease    :', s.currentRelease ? `${s.currentRelease.version} notes=${s.currentRelease.cn.length}b-zh/${s.currentRelease.en.length}b-en` : null);
console.log('notesAvailable    :', s.notesAvailable);
console.log('selectors         :');
for (const row of s.selectors) console.log('   ', row.id.padEnd(8), row.command);

// Version detection is deterministic and must always hold; everything below it
// depends on the network, so an offline run reports a skip instead of a failure.
//
// Upstream moves: this test asserts INVARIANTS of the plugin's logic, never the
// versions that happen to be current today. An earlier version of it hardcoded
// "latest == 0.1.5-rc.2" and started failing the moment npm published rc.3, which
// said nothing about the plugin and everything about the test.
const problems = [];
const skipped = [];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
function parts(version) {
  const m = SEMVER.exec(String(version));
  return m === null ? null : { core: m[0].split('-')[0].split('.').map(Number), pre: m[0].includes('-') ? m[0].split('-')[1].split('.') : [] };
}
function compare(a, b) {
  const x = parts(a);
  const y = parts(b);
  if (x === null || y === null) return null;
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] < y.core[i] ? -1 : 1;
  if (x.pre.length === 0 || y.pre.length === 0) return x.pre.length === y.pre.length ? 0 : (x.pre.length === 0 ? 1 : -1);
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p);
    const qn = /^\d+$/.test(q);
    if (pn && qn && Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1;
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

if (!SEMVER.test(String(s.current.version))) problems.push(`installed version is not a semver: ${s.current.version}`);
if (s.current.source === 'unknown') problems.push('the installed version was not detected from the running CLI');
if (typeof s.current.channel !== 'string' || s.current.channel === 'unknown') problems.push(`installed channel not derived: ${s.current.channel}`);

if (s.ok !== true) {
  skipped.push(`registry source unavailable — network-derived checks skipped (${s.sources.map(source => `${source.id}:${source.error}`).join(', ')})`);
} else {
  // updateAvailable must equal "the target really is newer than what we run".
  const cmp = compare(s.target.version, s.current.version);
  if (cmp === null) problems.push(`target version is not comparable: ${s.target.version}`);
  else if (s.updateAvailable !== (cmp > 0)) problems.push(`updateAvailable=${s.updateAvailable} disagrees with semver (target ${s.target.version} vs current ${s.current.version})`);

  // versionsBehind counts exactly the newer versions it lists.
  if (s.versionsBehind !== s.newerVersions.length) problems.push(`versionsBehind=${s.versionsBehind} but ${s.newerVersions.length} version(s) listed`);

  // Every listed version must be newer, newest first.
  for (const version of s.newerVersions) {
    if ((compare(version, s.current.version) ?? 0) <= 0) problems.push(`newerVersions contains ${version}, which is not newer than ${s.current.version}`);
  }
  const sorted = s.newerVersions.every((version, i) => i === 0 || (compare(s.newerVersions[i - 1], version) ?? 0) >= 0);
  if (!sorted) problems.push(`newerVersions is not newest-first: ${s.newerVersions.join(', ')}`);

  // A dist-tag pointing below the installed build is the trap we warn about; any
  // entry reported must genuinely be lower, and `latest` being one of them is
  // normal for an alpha install but not something to assert on.
  for (const entry of s.downgradeTags) {
    if ((compare(entry.version, s.current.version) ?? 0) >= 0) problems.push(`downgradeTags lists ${entry.tag}=${entry.version}, which is not below ${s.current.version}`);
  }
  console.log(`downgrade traps   : ${s.downgradeTags.length === 0 ? 'none today' : s.downgradeTags.map(entry => `${entry.tag}->${entry.version}`).join(', ')}`);

  if (s.notesAvailable !== true) skipped.push('release notes source unavailable — annotation skipped');
  else if (s.currentRelease === null) problems.push('expected release notes for the installed version');
  else if (typeof s.currentRelease.summary?.breaking !== 'number') problems.push('release notes carry no annotation summary');
  else if (s.currentRelease.summary.breaking + s.currentRelease.summary.caution > s.currentRelease.summary.items) {
    problems.push(`annotation counts exceed the bullet count (${JSON.stringify(s.currentRelease.summary)})`);
  }
}

console.log('\n' + (problems.length === 0 ? 'ASSERTIONS PASS' : `ASSERTIONS FAIL:\n - ${problems.join('\n - ')}`));
if (skipped.length > 0) console.log(`environmental skips:\n - ${skipped.join('\n - ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
