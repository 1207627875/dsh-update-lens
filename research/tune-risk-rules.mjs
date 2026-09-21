/**
 * Evaluation harness for notes.js against real release bodies.
 * Prints flags, and also the unflagged bullets of risk-prone sections so false
 * negatives are visible too. Saves fixtures for the regression test.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { annotateText } from '../notes.js';

const response = await fetch('https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=6', {
  headers: { 'user-agent': 'dsh-tune', accept: 'application/vnd.github+json' },
  signal: AbortSignal.timeout(25_000),
});
const releases = await response.json();

const RISKY_SECTION = /其他变更|Chores|其他|Other/i;
const fixtures = [];

for (const release of releases) {
  const body = release.body ?? '';
  const marker = body.search(/<h3 id="en-/);
  const clean = value => value
    .replace(/<h3 id="(?:cn|en)-[^"]*">/g, '')
    .replace(/<\/h3>/g, '')
    .split('\n')
    .filter(line => !/^\[[^\]]*\]\(#/.test(line.trim()))
    .join('\n')
    .trim();
  const cn = clean(marker >= 0 ? body.slice(0, marker) : body);
  const en = clean(marker >= 0 ? body.slice(marker) : '');

  console.log(`\n${'='.repeat(76)}\n## ${release.tag_name}   cn=${cn.length}b en=${en.length}b`);
  if (fixtures.length < 2 && cn.length > 1000) fixtures.push({ tag: release.tag_name, cn, en });

  for (const [locale, text] of [['cn', cn], ['en', en]]) {
    const { blocks, summary } = annotateText(text, locale);
    const flagged = blocks.filter(block => block.level !== null);
    console.log(`\n-- ${locale}: breaking=${summary.breaking} caution=${summary.caution} bullets=${summary.items}`);
    for (const block of flagged) {
      console.log(`   ${block.level === 'breaking' ? '!!' : ' ~'} [${block.section ?? ''}] ${block.text.slice(0, 88)}`);
      console.log(`       ← ${block.words.join(' / ')}`);
    }
    const missed = blocks.filter(block => block.level === null && block.kind === 'item' && RISKY_SECTION.test(block.section ?? ''));
    if (missed.length > 0) {
      console.log(`   (unflagged in risk-prone sections: ${missed.length})`);
      for (const block of missed) console.log(`      · ${block.text.slice(0, 88)}`);
    }
  }
}

mkdirSync(new URL('../tests/fixtures/', import.meta.url), { recursive: true });
for (const fixture of fixtures) {
  const name = fixture.tag.replace(/[^a-z0-9.-]/gi, '_');
  writeFileSync(new URL(`../tests/fixtures/${name}.json`, import.meta.url), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
  console.log(`\nsaved fixture tests/fixtures/${name}.json`);
}
