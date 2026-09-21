/**
 * Regression test for the breaking-change annotator (notes.js).
 *
 * Runs against REAL captured release bodies (tests/fixtures/*.json), not
 * invented examples, and asserts both directions: the lines that must be flagged
 * and the look-alike lines that must stay quiet. The negative assertions are the
 * valuable ones — they encode the false positives already fixed once.
 *
 *   node tests/notes-rules.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { annotateText, annotateRelease, classifyLine } from '../notes.js';

const problems = [];
let checks = 0;

function assert(condition, message) {
  checks += 1;
  if (!condition) problems.push(message);
}

function blocksOf(fixture, locale) {
  const text = locale === 'cn' ? fixture.cn : fixture.en;
  return annotateText(text, locale).blocks;
}

/** Level of the first bullet whose text contains `needle`. */
function levelOf(blocks, needle) {
  const block = blocks.find(item => item.kind === 'item' && item.text.includes(needle));
  return block === undefined ? 'MISSING' : block.level;
}

const dir = new URL('./fixtures/', import.meta.url);
const fixtures = readdirSync(dir)
  .filter(name => name.endsWith('.json'))
  .map(name => JSON.parse(readFileSync(new URL(name, dir), 'utf8')));
assert(fixtures.length >= 2, `expected at least 2 fixtures, found ${fixtures.length}`);

const alpha2 = fixtures.find(fixture => fixture.tag === 'dsh-v0.1.6-alpha.2');
assert(alpha2 !== undefined, 'fixture dsh-v0.1.6-alpha.2 is missing');

if (alpha2 !== undefined) {
  const cn = blocksOf(alpha2, 'cn');
  const en = blocksOf(alpha2, 'en');

  // --- must be flagged (real breakage in the release that was current here) ---
  assert(levelOf(cn, '默认模型列表移除 V4 Flash') === 'breaking', 'cn: model-list removal must be breaking');
  assert(levelOf(cn, '请开发者检查插件加载和卸载逻辑') === 'breaking', 'cn: "developers, review" must be breaking');
  assert(levelOf(cn, '创造模式移除原 Cordis 动态定义') === 'breaking', 'cn: creator-mode removal must be breaking');
  assert(levelOf(cn, '相关 API 及 slot 有变化') === 'breaking', 'cn: interface change must be breaking');
  assert(levelOf(en, 'with changes to related APIs and slots') === 'breaking', 'en: interface change must be breaking');

  // --- must stay quiet: every one of these was a false positive at some point ---
  assert(levelOf(cn, 'Inbox 消息无法恢复的问题') === null, 'cn: a bug-fix mentioning 无法 must not be flagged');
  assert(levelOf(cn, '可在设置中调整') === null, 'cn: a user-adjustable default must not be flagged');
  assert(levelOf(cn, 'CLI 支持用 `dsh <profile>`') === null, 'cn: a new CLI capability must not be flagged');
  assert(levelOf(en, 'live enabling and disabling') === null, 'en: "enabling and disabling" is a feature, not a break');
  assert(levelOf(en, 'file change cards') === null, 'en: "file change cards" must not be flagged');

  // --- summary is consistent with the blocks ---
  const summary = annotateText(alpha2.cn, 'cn').summary;
  assert(summary.breaking === cn.filter(block => block.level === 'breaking').length, 'cn summary.breaking must equal flagged blocks');
  assert(summary.items > 20, `cn summary.items looks wrong: ${summary.items}`);

  // --- release-level summary takes the worse of the two locales ---
  const combined = annotateRelease(alpha2.cn, alpha2.en);
  const cnCount = cn.filter(block => block.level === 'breaking').length;
  const enCount = en.filter(block => block.level === 'breaking').length;
  assert(combined.summary.breaking === Math.max(cnCount, enCount), 'annotateRelease must report the max of both locales');
  assert(combined.cnBlocks.length > 0 && combined.enBlocks.length > 0, 'annotateRelease must return blocks for both locales');
}

const alpha1 = fixtures.find(fixture => fixture.tag === 'dsh-v0.1.6-alpha.1');
assert(alpha1 !== undefined, 'fixture dsh-v0.1.6-alpha.1 is missing');
if (alpha1 !== undefined) {
  const cn = blocksOf(alpha1, 'cn');
  const en = blocksOf(alpha1, 'en');
  assert(levelOf(en, 'Deprecate the synchronous Session history APIs') === 'breaking', 'en: deprecation must be breaking');
  assert(levelOf(en, 'Remove the built-in E2B execution backends') === 'breaking', 'en: backend removal must be breaking');
  assert(levelOf(cn, '旧名称不再兼容') === 'breaking', 'cn: "no longer compatible" must be breaking');
  assert(levelOf(cn, '请手动启用') === 'breaking', 'cn: "enable it manually" must be breaking');
  assert(levelOf(cn, '弃用 Session 的同步历史读取接口') === 'breaking', 'cn: interface deprecation must be breaking');
  assert(levelOf(cn, '新增 image offload 会话事件') === null, 'cn: a new session event must not be flagged');
  assert(levelOf(en, 'Add an image offload session event') === null, 'en: a new session event must not be flagged');
  assert(levelOf(cn, '支持随请求上报会话事件，当前实验性开启，可通过配置关闭') === null, 'cn: an opt-out experiment must not be flagged');
}

// --- structural properties that must hold on every fixture ---
for (const fixture of fixtures) {
  for (const locale of ['cn', 'en']) {
    const text = locale === 'cn' ? fixture.cn : fixture.en;
    const { blocks } = annotateText(text, locale);
    assert(blocks.every(block => block.kind === 'heading' || block.kind === 'item' || block.kind === 'para'), `${fixture.tag}/${locale}: unexpected block kind`);
    assert(blocks.every(block => block.kind !== 'heading' || block.level === null), `${fixture.tag}/${locale}: a heading must never carry a level`);
    assert(blocks.every(block => ['breaking', 'caution', null].includes(block.level)), `${fixture.tag}/${locale}: unknown level`);
    assert(blocks.every(block => Array.isArray(block.words)), `${fixture.tag}/${locale}: words must always be an array`);
    assert(blocks.filter(block => block.level === 'breaking').every(block => block.words.length > 0), `${fixture.tag}/${locale}: a breaking flag must name the words that produced it`);
    // Block texts must reconstruct the original bullets, in order, without loss.
    const bullets = text.split('\n').map(line => line.trim()).filter(line => line.startsWith('- ') || line.startsWith('* '));
    const rendered = blocks.filter(block => block.kind === 'item').map(block => block.text);
    assert(bullets.length === rendered.length, `${fixture.tag}/${locale}: lost bullets (${bullets.length} vs ${rendered.length})`);
  }
}

// --- a few aimed unit cases for the trickiest rules ---
assert(classifyLine('支持消息排队、编辑、删除、单条或全部 Steer。', 'cn', '新增功能').level === null, 'cn: "supports … deleting" must not be a removal');
assert(classifyLine('移除内置 E2B 执行后端，相关自定义配置需调整。', 'cn', '其他变更').level === 'breaking', 'cn: headline removal must be breaking');
assert(classifyLine('请求图片缓存移至 `DSH_HOME/cache`，删除后可重建；旧缓存不自动清理。', 'cn', '其他变更').level === 'caution', 'cn: a mid-sentence 删除 is a caution, not a break');
assert(classifyLine('correct added/deleted line counts', 'en', 'Bug Fixes').level === null, 'en: "deleted line counts" in a fix must be quiet');
assert(classifyLine('Breaking: plugin API removed.', 'en', 'Chores').level === 'breaking', 'en: explicit breaking must be breaking');

console.log(`fixtures: ${fixtures.map(fixture => fixture.tag).join(', ')}`);
console.log(`assertions run: ${checks}`);
console.log('\n' + (problems.length === 0 ? 'NOTES RULES PASS' : `NOTES RULES FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
