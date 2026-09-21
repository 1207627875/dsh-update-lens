/**
 * Encoding guard — run this after ANY bulk text edit, and before every commit.
 *
 * It exists because this repository was once damaged by exactly this: a
 * PowerShell bulk replace read UTF-8 sources with the system ANSI code page
 * (GBK) and wrote them back as UTF-8. Chinese became mojibake, and bytes GBK
 * could not map turned into '?' — which ate a closing quote and produced
 * `SyntaxError: Invalid or unexpected token`, i.e. a plugin that cannot load.
 *
 * Four independent checks, because each one alone has a blind spot:
 *   1. strict UTF-8 decode + byte-exact round trip  (catches invalid sequences)
 *   2. no U+FFFD anywhere                           (catches lossy decoding)
 *   3. no GBK-mojibake characters                   (catches the 2026-09-21 class)
 *   4. `node --check` on every JS file              (catches swallowed quotes)
 *
 * The mojibake alphabet is COMPUTED from real characters rather than written out,
 * so this file stays pure ASCII and can never flag itself.
 *
 *   node tests/encoding-check.mjs
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.txt']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

const gbk = new TextDecoder('gbk');

/** The pair-decoded prefix a character leaves behind when read as GBK, plus the '?' for the rest. */
function mojibakePrefix(char) {
  const utf8 = Buffer.from(char, 'utf8');
  for (let take = utf8.length; take > 0; take -= 1) {
    const decoded = gbk.decode(utf8.subarray(0, take));
    if (!decoded.includes('\uFFFD') && decoded.length > 0) return decoded;
  }
  return '';
}

// Seed vocabulary: this project's own Chinese plus the punctuation a bulk edit
// mangles first. Their mojibake forms become the marker alphabet.
const SEED = '更新中心插件设置版本检查内容说明网络来源出口策略破坏性注意代理端口检测失败成功新建删除修改运行环境客户端标签发布通道说明数据文件读取写入编码规范安全配置导入导出';
const MOJIBAKE_ALPHABET = new Set();
for (const char of SEED) for (const piece of mojibakePrefix(char)) MOJIBAKE_ALPHABET.add(piece);
const PUNCTUATION = [
  '\u2014', '\u25cf', '\u2026', '\u300c', '\u300d', '\u201c', '\u201d', '\u2605', '\u25b2', '\u00b7',
  // Added after the 2026-09-21 second pass: '•' and '⚠' were mis-restored by the
  // first repair precisely because they were missing from this list.
  '\u2022', '\u26a0', '\u25b8', '\u25be', '\u25b6', '\u25bc', '\u00d7', '\u2264', '\u2265', '\u2192', '\u2190',
];

/**
 * A single rare character proves nothing (legitimate Chinese contains them), so
 * this needs a CLUSTER — real mojibake comes in runs, as in '鏇存柊涓績'.
 */
const ALPHABET = [...MOJIBAKE_ALPHABET].join('');
const CLUSTER_RE = ALPHABET === '' ? null : new RegExp(`[${ALPHABET}]{3,}`);

/**
 * Punctuation is the exception: its corrupted form is a rare character plus the
 * '?' that swallowed a byte, and that pair does not occur in real text — so an
 * exact match is unambiguous even at two characters.
 */
const PUNCTUATION_MARKERS = PUNCTUATION.map(char => mojibakePrefix(char) + '?').filter(marker => marker.length > 1);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) walk(full, out);
    else if (TEXT_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) out.push(full);
  }
  return out;
}

const problems = [];
const files = walk(ROOT);
let checked = 0;

for (const path of files) {
  const name = relative(ROOT, path);
  const bytes = readFileSync(path);
  checked += 1;

  // 0. no BOM: the project convention is plain UTF-8, and a BOM here is the
  //    fingerprint of a tool that wrote with an unstated encoding.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    problems.push(`${name}: UTF-8 BOM present (project convention is no BOM)`);
  }

  // 1. must be valid UTF-8, byte for byte. ignoreBOM keeps any U+FEFF in the
  //    string so the round-trip comparison stays byte-exact.
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    problems.push(`${name}: not valid UTF-8`);
    continue;
  }
  if (!Buffer.from(text, 'utf8').equals(bytes)) problems.push(`${name}: UTF-8 round trip changed the bytes`);

  // 2. no replacement character
  const fffd = (text.match(/\uFFFD/g) ?? []).length;
  if (fffd > 0) problems.push(`${name}: ${fffd} U+FFFD replacement character(s)`);

  // 3. no GBK mojibake — a cluster of rare characters, or an exact punctuation marker
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    const cluster = CLUSTER_RE === null ? null : CLUSTER_RE.exec(line);
    const marker = PUNCTUATION_MARKERS.find(candidate => line.includes(candidate));
    if (cluster !== null) problems.push(`${name}:${index + 1}: GBK mojibake run "${cluster[0]}" — ${line.trim().slice(0, 70)}`);
    else if (marker !== undefined) problems.push(`${name}:${index + 1}: GBK mojibake marker "${marker}" — ${line.trim().slice(0, 70)}`);
  });
}

// 4. every JS file parses
for (const path of files.filter(file => file.endsWith('.js') || file.endsWith('.mjs'))) {
  try {
    execFileSync(process.execPath, ['--check', path], { stdio: 'pipe' });
  } catch (error) {
    const message = String(error.stderr ?? error).split('\n').filter(Boolean).slice(0, 3).join(' ');
    problems.push(`${relative(ROOT, path)}: node --check failed — ${message}`);
  }
}

console.log(`files checked: ${checked} | mojibake alphabet: ${ALPHABET.length} chars`);
console.log('\n' + (problems.length === 0 ? 'ENCODING CHECK PASS' : `ENCODING CHECK FAIL (${problems.length}):\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
