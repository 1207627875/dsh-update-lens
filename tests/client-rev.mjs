/**
 * Client revision lock.
 *
 * Why this exists: the page reports its build (`CLIENT_REV`) to the Host on every
 * poll, and that report is the only way to tell "the open page is running the
 * current bundle" from "the page is running last week's bundle". It failed at
 * exactly that job once — client.js was rewritten with a new button while
 * CLIENT_REV stayed at its old value, so the diagnostic said "1.0.1" for two
 * different builds and made a support question harder to answer than it should
 * have been.
 *
 * So: whichever edit touches client.js must bump CLIENT_REV and update the hash
 * here. The failure message says exactly that.
 *
 *   node tests/client-rev.mjs
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** sha256(client.js) truncated, captured when CLIENT_REV was last bumped. */
const EXPECTED_HASH = '5a67454908d0cf03';
const EXPECTED_REV = '1.0.2';

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
const actualHash = createHash('sha256').update(source).digest('hex').slice(0, 16);
const revMatch = /const CLIENT_REV = '([^']+)'/.exec(source);
const problems = [];

if (revMatch === null) {
  problems.push('client.js no longer declares `const CLIENT_REV = \'…\'`');
} else if (revMatch[1] !== EXPECTED_REV) {
  problems.push(`CLIENT_REV is ${revMatch[1]} but this test expects ${EXPECTED_REV} — update EXPECTED_REV here too`);
}

if (actualHash !== EXPECTED_HASH) {
  problems.push(
    `client.js changed (hash ${actualHash}, expected ${EXPECTED_HASH}).\n` +
    '   → bump CLIENT_REV in client.js (so the page reports a new build), then set\n' +
    `   → EXPECTED_REV and EXPECTED_HASH in this file to the new values.`,
  );
}

console.log(`client rev : ${revMatch === null ? '(missing)' : revMatch[1]}`);
console.log(`client hash: ${actualHash}`);
console.log('\n' + (problems.length === 0 ? 'CLIENT REV PASS' : `CLIENT REV FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
