/**
 * Capture real release bodies as test fixtures.
 *
 * The annotation rules are tuned against actual release notes, so when upstream
 * changes their FORMAT (0.1.7 introduced emoji headings like "✨ 新增" / "🐛 修复"),
 * the fixtures are how that gets noticed and pinned down. Run this after a new
 * release appears, then run tests/notes-rules.mjs.
 *
 * Existing fixtures are kept; only new tags are written (a fixture that a rule was
 * tuned against should not silently change under the test).
 *
 *   node research/capture-fixtures.mjs
 */
import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { annotateText, splitReleaseBody } from '../notes.js';

const DIR = new URL('../tests/fixtures/', import.meta.url);
mkdirSync(DIR, { recursive: true });
const existing = new Set(readdirSync(DIR).filter(name => name.endsWith('.json')).map(name => name.replace(/\.json$/, '')));

const response = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=30', {
  headers: { 'user-agent': 'dsh-update-lens', accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  console.log(`FAILED: HTTP ${response.status} (GitHub unreachable — try again later or use the proxy)`);
  process.exit(1);
}
const releases = await response.json();

let added = 0;
for (const release of releases) {
  const { cn, en } = splitReleaseBody(release.body ?? '');
  const tag = String(release.tag_name);
  const file = `${tag.replace(/[^a-z0-9.-]/gi, '_')}.json`;

  // Report the headings the ANNOTATOR recognises (not a lookalike heuristic), so
  // this log reflects what the page will actually section the notes into.
  const headings = annotateText(cn, 'cn').blocks.filter(block => block.kind === 'heading').map(block => block.text);
  console.log(`${tag.padEnd(20)} cn=${String(cn.length).padStart(5)}b headings: ${headings.length > 0 ? headings.join(' | ') : '(none)'}`);

  // --refresh rewrites every fixture with the CURRENT cleaner, so the stored text
  // is exactly what the Host would annotate (they once drifted apart).
  const refresh = process.argv.includes('--refresh');
  if (existing.has(file.replace(/\.json$/, '')) && !refresh) {
    console.log('   already captured');
    continue;
  }
  if (cn.length < 200) {
    console.log('   too small to be useful, skipped');
    continue;
  }
  // Write through a temp name: an interrupted run must not leave a half-written
  // fixture behind, which is exactly what a killed process did once before.
  const target = new URL(file, DIR);
  const temp = new URL(`${file}.tmp`, DIR);
  writeFileSync(temp, `${JSON.stringify({ tag, cn, en }, null, 2)}\n`, 'utf8');
  renameSync(temp, target);
  console.log(`   ${refresh && existing.has(file.replace(/\.json$/, '')) ? 'refreshed' : 'saved'} tests/fixtures/${file}`);
  added += 1;
}

console.log(`\nnew fixtures: ${added}`);
console.log(added > 0 ? 'next: node tests/notes-rules.mjs   (and extend the rules if a new heading style appears)' : 'nothing to do');
