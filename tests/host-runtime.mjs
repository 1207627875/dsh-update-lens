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
const problems = [];
const skipped = [];
if (s.current.version !== '0.1.6-alpha.2') problems.push(`expected current 0.1.6-alpha.2, got ${s.current.version}`);
if (s.current.channel !== 'alpha') problems.push(`expected channel alpha, got ${s.current.channel}`);

if (s.ok !== true) {
  skipped.push(`registry source unavailable — network-derived checks skipped (${s.sources.map(source => `${source.id}:${source.error}`).join(', ')})`);
} else {
  if (s.newestSameChannel !== '0.1.6-alpha.2') problems.push(`expected newestSameChannel 0.1.6-alpha.2, got ${s.newestSameChannel}`);
  if (s.updateAvailable !== false) problems.push('expected updateAvailable=false (already newest in channel)');
  if (!s.downgradeTags.some(entry => entry.tag === 'latest' && entry.version === '0.1.5-rc.2')) {
    problems.push(`expected a latest-tag downgrade warning, got ${JSON.stringify(s.downgradeTags)}`);
  }
  if (s.notesAvailable !== true) skipped.push('release notes source unavailable — annotation skipped');
  else if (s.currentRelease === null) problems.push('expected release notes for the installed version');
  else if (typeof s.currentRelease.summary?.breaking !== 'number') problems.push('release notes carry no annotation summary');
}

console.log('\n' + (problems.length === 0 ? 'ASSERTIONS PASS' : `ASSERTIONS FAIL:\n - ${problems.join('\n - ')}`));
if (skipped.length > 0) console.log(`environmental skips:\n - ${skipped.join('\n - ')}`);
process.exitCode = problems.length === 0 ? 0 : 1;
