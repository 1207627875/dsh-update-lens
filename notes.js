/**
 * Breaking-change annotation for DSH release notes.
 *
 * Pure functions only — no I/O — so the rules can be tested against real
 * release bodies (tests/notes-rules.mjs) instead of invented examples.
 *
 * The failure modes of a naive "scary words" list are both real, so the rules
 * are deliberately shaped to trade recall for precision:
 *
 *   - `无法` / `deleted` / bare `default` match bug-fix prose ("修复…无法恢复的
 *     问题", "correct added/deleted line counts"), so they are not risk words at
 *     all, and a fix-section bullet can only be flagged by a top-tier phrase.
 *   - `删除` in "支持消息排队、编辑、删除" is a *feature*, not a removal, so a
 *     removal word inside a list of supported actions is demoted.
 *   - An interface noun next to a change verb ("相关 API 及 slot 有变化",
 *     "with changes to related APIs and slots") is breaking even with no strong
 *     word, because that is exactly what breaks a third-party plugin.
 *
 * Every flag carries the words that produced it, so no verdict is unexplainable.
 */

/** Top tier: survives section filters and is always breaking. */
const TOP_CN = ['不兼容', '破坏性', '弃用', '废弃', '必须', '请开发者检查', '迁移'];
const TOP_EN = ['incompatible', 'breaking', 'deprecat', 'no longer', 'must ', 'mandatory', 'migration required'];

/** Second tier: breaking outside a fix/addition section. */
const BREAKING_CN = [...TOP_CN, '不再', '移除', '删除', '重命名', '改名', '需适配', '要适配', '需更新', '需要更新', '需调整', '需要调整', '需手动', '需要手动', '请手动', '需同步', '要同步'];
const BREAKING_EN = [...TOP_EN, 'remov', 'delet', 'renam', 'adapt', 'requires update', 'require update', 'needs update', 'needs migration', 'migration', 'developers should', 'plugin authors', 'plugin developers'];

/**
 * Third tier: behaviour / defaults moved. Interface nouns are deliberately NOT
 * here — they only count next to a change verb (see hasInterfaceChange), which
 * is what keeps "connect to the official API endpoint" out of the warnings.
 */
const CAUTION_CN = ['调整', '变更', '改为', '变化', '配置项', '行为', '语义', '依赖', '参数', '字段', '替代', '取代', '默认值', '上限', '阈值', '顺序', '取消', '回滚', '请注意', '需注意'];
const CAUTION_EN = ['adjust', 'behavior', 'behaviour', 'default', 'replac', 'split', 'merg', 'depend', 'requir', 'disable ', 'disables ', 'disabled by default'];

/** Interface nouns + change verbs: breaking on their own. */
const INTERFACE_CN = ['接口', 'API', 'slot', '协议', '字段', '参数', '配置项', '包名', '服务名', '环境变量'];
const INTERFACE_EN = ['api', 'slot', 'interface', 'protocol', 'field', 'parameter', 'config key', 'package name', 'service name', 'env var'];
const MOVE_CN = ['变化', '变更', '调整', '改为', '改名', '重命名', '不再', '移除', '删除', '拆分', '合并', '统一'];
const MOVE_EN = ['change', 'adjust', 'renam', 'no longer', 'remov', 'delet', 'split', 'merg', 'unif'];

const FIX_SECTION = /问题修复|缺陷|Bug Fixes|Fixes|Fixed/i;
/** Additions and polish describe what improved; only a top-tier phrase belongs there. */
const ADD_SECTION = /新增功能|新功能|体验优化|改进|优化|New Features|New feature|Improvements|Improvement/i;
/** "可在设置中调整" — user-controllable, so a plain move verb is not a warning. */
const OPTIONAL = /可在设置|可在配置|可通过配置|可通过设置|可自行|可手动关闭|可手动开启|可关闭|configurable|optional/i;
/** A removal word here continues a list of supported actions ("…、删除、…"). */
const SUPPORT_BEFORE_CN = /(支持|可以|可|允许|新增)[^。；;]{0,14}$/;
const SUPPORT_BEFORE_EN = /(support|allow|can|add)[^.;]{0,20}$/;
/** Removal words that co-occur with "you must act" phrasing are headlines regardless of position. */
const COMPANION_CN = ['需适配', '要适配', '需更新', '需要更新', '需调整', '需要调整', '需手动', '请手动', '不再', '必须'];
const COMPANION_EN = ['requires update', 'require update', 'needs update', 'needs migration', 'no longer', 'must ', 'adapt', 'update custom', 'manual'];

function hits(haystack, words) {
  const found = [];
  for (const word of words) {
    if (haystack.includes(word) && !found.includes(word)) found.push(word);
  }
  return found;
}

function hasInterfaceChange(text, locale) {
  const nouns = locale === 'en' ? INTERFACE_EN : INTERFACE_CN;
  const verbs = locale === 'en' ? MOVE_EN : MOVE_CN;
  return nouns.some(noun => text.includes(noun)) && verbs.some(verb => text.includes(verb));
}

/**
 * Is this removal word the point of the bullet, or incidental prose?
 * "移除内置 E2B 执行后端" is a headline; "请求图片缓存移至 …，删除后可重建" is not.
 */
function removalIsHeadline(text, word, locale) {
  const at = text.indexOf(word);
  if (at < 0) return false;
  const before = text.slice(0, at);
  if ((locale === 'en' ? SUPPORT_BEFORE_EN : SUPPORT_BEFORE_CN).test(before)) return false;
  if (at < 16) return true;
  return (locale === 'en' ? COMPANION_EN : COMPANION_CN).some(mark => text.includes(mark));
}

/**
 * Classify one bullet.
 * @returns {{ level: 'breaking'|'caution'|null, words: string[] }}
 */
export function classifyLine(text, locale, section = '') {
  const haystack = locale === 'en' ? String(text).toLowerCase() : String(text);
  const top = hits(haystack, locale === 'en' ? TOP_EN : TOP_CN);

  const sectionIsBenign = FIX_SECTION.test(section) || ADD_SECTION.test(section);
  if (sectionIsBenign) {
    return top.length > 0 ? { level: 'breaking', words: top } : { level: null, words: [] };
  }

  const removalWords = locale === 'en' ? ['remov', 'delet'] : ['移除', '删除'];
  const breakingHits = hits(haystack, locale === 'en' ? BREAKING_EN : BREAKING_CN);
  const headlineRemovals = breakingHits.filter(word => removalWords.includes(word) && removalIsHeadline(haystack, word, locale));
  const buriedRemovals = breakingHits.filter(word => removalWords.includes(word) && !headlineRemovals.includes(word));
  const strong = [...breakingHits.filter(word => !removalWords.includes(word)), ...headlineRemovals];
  if (strong.length > 0) return { level: 'breaking', words: strong };

  if (hasInterfaceChange(haystack, locale)) {
    const nouns = (locale === 'en' ? INTERFACE_EN : INTERFACE_CN).filter(noun => haystack.includes(noun));
    const verbs = (locale === 'en' ? MOVE_EN : MOVE_CN).filter(verb => haystack.includes(verb));
    return { level: 'breaking', words: [...nouns, ...verbs].slice(0, 4) };
  }

  const caution = hits(haystack, locale === 'en' ? CAUTION_EN : CAUTION_CN);
  const words = [...caution, ...buriedRemovals];
  if (words.length === 0) return { level: null, words: [] };
  // "可在设置中调整" is a choice, not a change being forced on you.
  const kept = OPTIONAL.test(haystack) ? words.filter(word => !/^(调整|变更|改为|adjust)$/.test(word)) : words;
  return kept.length > 0 ? { level: 'caution', words: [...new Set(kept)] } : { level: null, words: [] };
}

/**
 * Turn one locale's note text into renderable blocks plus a risk summary.
 * Headings, bullets and paragraphs keep their order; bullets carry the verdict.
 */
export function annotateText(text, locale = 'cn') {
  const blocks = [];
  let section = '';
  const summary = { breaking: 0, caution: 0, items: 0 };
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('#')) {
      section = line.replace(/^#+\s*/, '');
      blocks.push({ kind: 'heading', text: section, level: null, words: [] });
      continue;
    }
    const bullet = line.startsWith('- ') || line.startsWith('* ');
    const body = bullet ? line.slice(2) : line;
    if (bullet) summary.items += 1;
    const verdict = bullet ? classifyLine(body, locale, section) : { level: null, words: [] };
    if (verdict.level === 'breaking') summary.breaking += 1;
    if (verdict.level === 'caution') summary.caution += 1;
    blocks.push({
      kind: bullet ? 'item' : 'para',
      text: body,
      level: verdict.level,
      words: verdict.words,
      section: bullet ? section : undefined,
    });
  }
  return { blocks, summary };
}

/** Both locales of one release, annotated. */
export function annotateRelease(cn, en) {
  const cnResult = annotateText(cn, 'cn');
  const enResult = annotateText(en, 'en');
  return {
    cnBlocks: cnResult.blocks,
    enBlocks: enResult.blocks,
    summary: {
      breaking: Math.max(cnResult.summary.breaking, enResult.summary.breaking),
      caution: Math.max(cnResult.summary.caution, enResult.summary.caution),
      items: Math.max(cnResult.summary.items, enResult.summary.items),
    },
  };
}
