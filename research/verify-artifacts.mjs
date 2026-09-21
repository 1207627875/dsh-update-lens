/**
 * Verifier for the residual artifacts of the 2026-09-21 encoding incident.
 *
 * History, because the failure mode is subtle and worth keeping:
 *   1. A PowerShell bulk rename read UTF-8 as GBK and wrote it back as UTF-8.
 *      Chinese became mojibake; one byte per punctuation mark was consumed by the
 *      decoder, which ate the closing quote of `navBadge: '更新中心 ●',` and
 *      produced SyntaxError: Invalid or unexpected token.
 *   2. The first repair rebuilt the Chinese dictionary and replaced every
 *      corrupted em-dash form with U+2014. That was right for em dashes and WRONG
 *      for the three other characters sharing that prefix: the ellipsis in a
 *      docstring, the notes bullet, and both warning glyphs — all four came back
 *      as U+2014 or U+25CF. It also left a missing space after every " — ".
 *   3. The first-pass guard reported PASS on those files, because its punctuation
 *      list did not cover '•' or '⚠'. Both the list and this verifier exist so the
 *      class stays closed.
 *
 * Pure ASCII source: every character under test is written as an escape, so this
 * file can never be the thing that rots.
 *
 *   node research/verify-artifacts.mjs
 */
import { readFileSync } from 'node:fs';

const path = name => new URL(`../${name}`, import.meta.url).pathname.replace(/^\//, '');
const EM = '\u2014';
const ELLIPSIS = '\u2026';
const BULLET = '\u2022';
const WARNING = '\u26a0';
const DASH_DASH = `${EM}${EM}`;

const problems = [];
const check = (condition, message) => {
  if (!condition) problems.push(message);
};

// --- the glyphs that were mis-restored must be back, in the right place ------
const index = readFileSync(path('index.js'), 'utf8');
check(index.includes(`id="cn-${ELLIPSIS}"`), 'index.js: the release-body docstring should read id="cn-…"');
check(index.includes(`id="en-${ELLIPSIS}"`), 'index.js: the release-body docstring should read id="en-…"');

const client = readFileSync(path('client.js'), 'utf8');
check(client.includes(`? '!' : '${BULLET}'`), `client.js: the unflagged notes bullet should be ${JSON.stringify(BULLET)}`);
check(
  (client.match(new RegExp(`'${WARNING}'`, 'g')) ?? []).length === 2,
  `client.js: both warning glyphs should be ${JSON.stringify(WARNING)} (risk banner + page banner)`,
);
check(!client.includes(`? '!' : '${EM}'`), 'client.js: a note bullet is still an em dash');
check(!client.includes(`> 0 ? '${EM}'`), 'client.js: a warning glyph is still an em dash or a dot');
check(!client.includes(`['${EM}', h('span'`), 'client.js: the page banner glyph is still an em dash');

// --- no space was left glued to an em dash ----------------------------------
// " —word" is the signature; Chinese "——" (double dash) is legitimate and exempt.
const GLUED = new RegExp(`(\\s)${EM}(?=[^\\s${EM}])`, 'g');
for (const name of ['index.js', 'notes.js', 'client.js', 'tests/host-runtime.mjs', 'tests/proxy-path.mjs', 'tests/resolve-check.mjs']) {
  const text = readFileSync(path(name), 'utf8');
  text.split('\n').forEach((line, i) => {
    if (GLUED.test(line)) problems.push(`${name}:${i + 1}: em dash glued to the next word — ${line.trim().slice(0, 70)}`);
    GLUED.lastIndex = 0;
  });
}

// --- the legitimate double dash is still there (we did not "fix" it away) ----
check(client.includes(DASH_DASH), 'client.js: the Chinese double dash in downgradeBody is missing');

console.log(`em dash: ${EM}  ellipsis: ${ELLIPSIS}  bullet: ${BULLET}  warning: ${WARNING}`);
console.log('\n' + (problems.length === 0 ? 'ARTIFACT VERIFY PASS' : `ARTIFACT VERIFY FAIL (${problems.length}):\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
