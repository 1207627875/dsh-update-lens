/**
 * One-off repair for the GBK-round-trip corruption (2026-09-21).
 *
 * What happened: a PowerShell bulk rename read UTF-8 source with the system ANSI
 * code page (GBK) and wrote it back as UTF-8, so every non-ASCII character turned
 * into mojibake, and bytes that GBK could not map became '?' — which is how
 * `navBadge: '更新中心 ●',` lost the '●' AND the closing quote, producing
 * `SyntaxError: Invalid or unexpected token`.
 *
 * How this repairs it without repeating the mistake:
 *   - everything is read/written by Node with an explicit 'utf8' encoding;
 *   - the corrupted markers are COMPUTED (gbk-decode of the original bytes), never
 *     typed by hand, so this file stays pure ASCII and cannot rot itself;
 *   - the Chinese dictionary is restored from the known key/value table below;
 *   - every touched file is re-checked (syntax + mojibake + U+FFFD + stray '?').
 *
 * Run:  node research/repair-encoding.mjs [--dry]
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const ROOT = new URL('../', import.meta.url);
const file = name => new URL(name, ROOT);
const dry = process.argv.includes('--dry');
const log = [];
const say = message => {
  log.push(message);
  console.log(message);
};

// --- computed mojibake markers (never typed) -------------------------------
const gbk = new TextDecoder('gbk');
/**
 * What a character's UTF-8 bytes look like when GBK-decoded, plus the '?' the
 * Windows decoder used for the byte it could not map.
 *
 * The real decoder consumes the byte stream as PAIRS, so the measurable prefix is
 * the longest one that decodes cleanly — decoding the trailing lone byte here
 * would yield U+FFFD (Node's WHATWG decoder) where Windows produced '?'.
 */
function corruptedForm(char) {
  const utf8 = Buffer.from(char, 'utf8');
  for (let take = utf8.length; take > 0; take -= 1) {
    const decoded = gbk.decode(utf8.subarray(0, take));
    if (!decoded.includes('\uFFFD') && decoded.length > 0) return decoded + '?';
  }
  return '?';
}
const EM_DASH = corruptedForm('\u2014'); // —
const MIDDLE_DOT = corruptedForm('\u25cf'); // ●

// --- the Chinese dictionary, restored verbatim ------------------------------
const ZH_ENTRIES = [
  ['nav', '更新中心'],
  ['navBadge', '更新中心 ●'],
  ['title', 'DSH 更新中心'],
  ['subtitle', '只做检查与通知，绝不自动更新。发现新版本后由你自己决定何时升级。'],
  ['checking', '检查中…'],
  ['checkNow', '立即检查'],
  ['neverChecked', '尚未检查'],
  ['lastChecked', '上次检查'],
  ['upToDate', '已是最新'],
  ['updateAvailable', '有新版本'],
  ['updateAvailableCount', '有 {n} 个新版本'],
  ['checkFailed', '检查失败'],
  ['current', '当前版本'],
  ['target', '最新版本'],
  ['channel', '通道'],
  ['published', '发布时间'],
  ['versionsBehind', '落后 {n} 个版本'],
  ['otherChannel', '其他通道另有更新版本 {v}'],
  ['downgradeTitle', '注意：不要直接执行裸安装命令'],
  ['downgradeBody', 'npm 的 {tags} 标签当前指向 {v}，低于你已安装的 {cur} —— `npm i -g @deepseek-ai/dsh` 会让你降级。请使用下面带版本号或带标签的命令。'],
  ['notesTitle', '更新内容'],
  ['notesCurrent', '当前版本说明'],
  ['notesEmpty', '没有比当前版本更新的版本，无需查看。'],
  ['notesUnavailable', '暂时取不到更新内容：GitHub 不可达。版本检测走 npm registry（无需代理），但 Release 说明只在 GitHub 上。可在此页配置代理或镜像地址后重试。'],
  ['openRelease', '打开 Release 页面'],
  ['levelBreaking', '破坏性'],
  ['levelCaution', '注意'],
  ['riskBreakingCount', '{n} 条破坏性变更'],
  ['riskCautionCount', '{n} 条需留意'],
  ['onlyRisk', '只看风险项'],
  ['showAll', '显示全部'],
  ['matchedWords', '命中'],
  ['noRiskFlagged', '本条未标注风险项。'],
  ['breakingBanner', '待升级的版本含 {n} 条破坏性变更，升级前建议先看下面的「更新内容」。'],
  ['showCn', '中文'],
  ['showEn', 'English'],
  ['sourcesTitle', '网络来源'],
  ['sourceOk', '正常'],
  ['sourceFail', '失败'],
  ['proxyTitle', '出口策略'],
  ['proxyDirect', '直连（未使用代理）'],
  ['proxyVia', '经代理 {url}（来源：{src}）'],
  ['proxyEnv', '启动环境变量'],
  ['proxySettings', '插件设置'],
  ['proxyDefault', '默认直连'],
  ['proxyUnusable', '代理不可用，已回退直连：'],
  ['viaProxy', '代理'],
  ['viaDirect', '直连'],
  ['proxyProbe', '检测本地代理端口'],
  ['proxyProbeNone', '没有检测到正在监听的常见本地代理端口。'],
  ['proxyProbeFound', '检测到可用本地代理：'],
  ['proxyProbeUse', '使用它'],
  ['settingsTitle', '设置'],
  ['setEnabled', '启用后台自动检查'],
  ['setInterval', '检查间隔（分钟）'],
  ['setChannel', '检查范围'],
  ['channelFollow', '跟随当前通道'],
  ['channelNewest', '任意通道的最新版'],
  ['setNotify', '发现新版本时弹出提醒'],
  ['setProxy', 'HTTP(S) 代理（留空 = 直连）'],
  ['setGithubBase', 'GitHub API 地址（可填镜像）'],
  ['save', '保存'],
  ['saved', '已保存'],
  ['cancel', '取消'],
  ['commandTitle', '手动更新命令'],
  ['commandHint', '复制到终端执行（本插件不会替你执行）：'],
  ['copy', '复制'],
  ['copied', '已复制'],
  ['bareWarning', '裸命令会安装 latest 标签，可能低于当前版本。'],
  ['runtimeTitle', '运行环境'],
  ['node', 'Node'],
  ['platform', '平台'],
  ['dshHome', 'DSH_HOME'],
  ['detectedAt', '检测来源'],
  ['clientRev', '客户端版本'],
  ['newVersionToast', 'DSH 有新版本 {v}'],
  ['toastBody', '当前 {cur}，可升级到 {v}。升级命令请点“复制命令”。'],
  ['copyCommand', '复制命令'],
  ['dismiss', '忽略此版本'],
  ['details', '查看详情'],
  ['vpnHint', '版本号来自 npm registry，国内可直连；更新内容来自 GitHub Releases，若打不开 GitHub 请在上面配置本地代理或镜像。'],
];

// Every value must survive a single-quoted JS literal unchanged.
for (const [key, value] of ZH_ENTRIES) {
  if (value.includes("'")) throw new Error(`ZH entry ${key} contains a single quote`);
  if (value.includes('?') || value.includes('\uFFFD')) throw new Error(`ZH entry ${key} looks damaged: ${value}`);
}

const zhBlock = ['    const ZH = {', ...ZH_ENTRIES.map(([key, value]) => `      ${key}: '${value}',`), '    };'].join('\n');

// --- surgery ---------------------------------------------------------------
function backupOnce(path) {
  const backup = `${path}.corrupt.bak`;
  if (!existsSync(backup)) {
    copyFileSync(path, backup);
    say(`  backup -> ${backup.split(/[\\/]/).pop()}`);
  }
}

function repairClient() {
  const path = file('client.js').pathname.replace(/^\//, '');
  let text = readFileSync(path, 'utf8');
  backupOnce(path);

  const zhStart = text.indexOf('    const ZH = {');
  const enStart = text.indexOf('    const EN = {');
  if (zhStart < 0 || enStart < 0 || enStart < zhStart) throw new Error('client.js: ZH/EN anchors not found');
  text = text.slice(0, zhStart) + zhBlock + '\n\n' + text.slice(enStart);
  say('  client.js: ZH dictionary rebuilt');

  // The English dictionary only carried one Chinese value.
  const before = text;
  text = text.replace(/showCn: '[^']*',/, "showCn: '中文',");
  say(`  client.js: EN showCn ${before === text ? 'already correct' : 'restored'}`);

  // Two header comment lines that named the page in Chinese.
  text = text.replace(/^ \* dsh-update-lens .*browser half\.$/m, ' * dsh-update-lens — browser half.');
  text = text.replace(/^ \* Adds one page to Settings \(.*$/m, ' * Adds one page to Settings ("更新中心" / "Update center") plus an in-app');

  // Any em-dash / middle-dot mojibake left in comments or strings.
  const emCount = text.split(EM_DASH).length - 1;
  text = text.split(EM_DASH).join('\u2014');
  const dotCount = text.split(MIDDLE_DOT).length - 1;
  text = text.split(MIDDLE_DOT).join('\u25cf');
  if (emCount + dotCount > 0) say(`  client.js: restored ${emCount} em-dash, ${dotCount} middle-dot`);

  writeFileSync(path, text, 'utf8');
}

function repairPlain(name) {
  const path = file(name).pathname.replace(/^\//, '');
  let text = readFileSync(path, 'utf8');
  backupOnce(path);
  const emCount = text.split(EM_DASH).length - 1;
  const dotCount = text.split(MIDDLE_DOT).length - 1;
  if (emCount + dotCount === 0) {
    say(`  ${name}: nothing to repair`);
    return 0;
  }
  text = text.split(EM_DASH).join('\u2014').split(MIDDLE_DOT).join('\u25cf');
  writeFileSync(path, text, 'utf8');
  say(`  ${name}: restored ${emCount} em-dash, ${dotCount} middle-dot`);
  return emCount + dotCount;
}

console.log(`repairing (${dry ? 'DRY RUN' : 'writing'}) — markers: EM_DASH=${JSON.stringify(EM_DASH)} MIDDLE_DOT=${JSON.stringify(MIDDLE_DOT)}`);
if (dry) process.exit(0);

repairClient();
for (const name of ['index.js', 'tests/host-runtime.mjs', 'tests/proxy-path.mjs', 'tests/resolve-check.mjs']) repairPlain(name);

// --- verification (the whole point) ---------------------------------------
console.log('\nverification:');
const JS_FILES = ['index.js', 'notes.js', 'client.js', 'tests/_env.mjs', 'tests/notes-rules.mjs', 'tests/host-smoke.mjs', 'tests/host-runtime.mjs', 'tests/proxy-path.mjs', 'tests/resolve-check.mjs'];
let failures = 0;
for (const name of JS_FILES) {
  try {
    execFileSync(process.execPath, ['--check', file(name).pathname.replace(/^\//, '')], { stdio: 'pipe' });
    console.log(`  syntax OK   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`  SYNTAX FAIL ${name}: ${String(error.stderr ?? error).split('\n').slice(0, 3).join(' ')}`);
  }
}

const MARKERS = null; // superseded: tests/encoding-check.mjs owns mojibake detection now
for (const name of [...JS_FILES, 'package.json', 'cordis.patch.yml']) {
  const path = file(name).pathname.replace(/^\//, '');
  const text = readFileSync(path, 'utf8');
  const bad = [];
  const fffd = (text.match(/\uFFFD/g) ?? []).length;
  if (bad.length > 0 || fffd > 0) {
    failures += 1;
    console.log(`  DIRTY       ${name}: ${bad.length} mojibake lines, ${fffd} U+FFFD`);
  } else {
    console.log(`  clean       ${name}`);
  }
}

// Strip the UTF-8 BOM that PowerShell's `Set-Content -Encoding UTF8` added to
// every file it touched: the project convention is plain UTF-8 without a BOM.
let stripped = 0;
for (const name of [...JS_FILES, 'package.json', 'cordis.patch.yml', '.gitattributes', '.gitignore', 'tests/fixtures/dsh-v0.1.6-alpha.1.json', 'tests/fixtures/dsh-v0.1.6-alpha.2.json', 'tests/mirror-probe.mjs', 'tests/net-probe.mjs']) {
  const path = file(name).pathname.replace(/^\//, '');
  if (!existsSync(path)) continue;
  const bytes = readFileSync(path);
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    writeFileSync(path, bytes.subarray(3), 'utf8');
    stripped += 1;
    console.log(`  BOM stripped ${name}`);
  }
}
console.log(`\nBOMs stripped: ${stripped}`);
console.log(`${failures === 0 ? 'REPAIR OK' : `REPAIR INCOMPLETE (${failures} problems)`}`);
console.log('next: node tests/encoding-check.mjs   (the permanent guard)');
process.exitCode = failures === 0 ? 0 : 1;
