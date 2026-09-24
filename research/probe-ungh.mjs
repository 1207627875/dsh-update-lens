/**
 * What does the ungh.cc mirror actually return, and can the existing parser read
 * it? ungh.cc is the GitHub-data mirror used as the release-notes fallback when
 * api.github.com is unreachable; this script is how its shape was verified, and
 * how to re-verify it if the mirror ever changes.
 *
 *   node research/probe-ungh.mjs
 */
const RESERVED = /^\[[^\]]*\]\(#/;

const response = await fetch('https://ungh.cc/repos/deepseek-ai/deepseek-harness/releases', {
  headers: { 'user-agent': 'dsh-update-lens' },
  signal: AbortSignal.timeout(20_000),
});
const payload = await response.json();

console.log(`HTTP ${response.status} | top-level keys: ${Object.keys(payload).join(', ')}`);
console.log(`releases: ${payload.releases.length}`);
console.log(`release keys: ${Object.keys(payload.releases[0]).join(', ')}`);

const markdown = payload.releases[0].markdown;
console.log(`\nfirst tag     : ${payload.releases[0].tag}`);
console.log(`publishedAt   : ${payload.releases[0].publishedAt}`);
console.log(`body length   : ${markdown.length}`);
console.log(`has <h3 id="cn-  : ${markdown.includes('<h3 id="cn-')}`);
console.log(`has <h3 id="en-  : ${markdown.includes('<h3 id="en-')}`);
console.log(`has '### ' heads : ${/^### /m.test(markdown)}`);
console.log(`nav line is first: ${RESERVED.test(markdown.split('\n')[0].trim())}`);

const enAt = markdown.search(/<h3 id="en-/);
console.log(`\n--- first 300 chars ---\n${markdown.slice(0, 300).split('\n').map(line => `    ${line}`).join('\n')}`);
if (enAt >= 0) {
  console.log(`--- english block from offset ${enAt} ---\n${markdown.slice(enAt, enAt + 160).split('\n').map(line => `    ${line}`).join('\n')}`);
}
