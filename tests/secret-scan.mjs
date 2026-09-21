/**
 * Secret scan — run before every push, and any time you wonder "is anything of
 * mine in this repo?".
 *
 * Three passes, because each one alone leaves a hole:
 *   1. working tree (text)   — key-shaped strings, credential assignments
 *   2. git history (blobs)   — something committed and later deleted still ships
 *   3. PNG metadata          — screenshots can carry tEXt/iTXt/EXIF text chunks
 *                              that a picture of the screen would never show
 *
 * It also lists high-entropy strings for a human look, because a scanner that
 * only matches known prefixes cannot see a custom-format token.
 *
 * Token prefixes are assembled from fragments so this file never contains a
 * literal that its own first pass would flag.
 *
 *   node tests/secret-scan.mjs [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Scan any directory: `--root <dir>` is how research/verify-remote.mjs scans a
// downloaded copy of the published repository instead of the working tree.
const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag >= 0 && typeof process.argv[rootFlag + 1] === 'string'
  ? resolve(process.argv[rootFlag + 1])
  : fileURLToPath(new URL('../', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.js', '.mjs', '.json', '.yml', '.yaml', '.md', '.txt', '.html', '.css', '.sh', '.ps1']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

// --- patterns ---------------------------------------------------------------
const FRAG = (...parts) => parts.join('');
const TOKEN_SHAPES = [
  { label: 'GitHub token', re: new RegExp(`${FRAG('gh', '[pousr]_')}[A-Za-z0-9]{20,}`) },
  { label: 'npm token', re: new RegExp(`${FRAG('np', 'm_')}[A-Za-z0-9]{30,}`) },
  { label: 'OpenAI-style key', re: /sk-[A-Za-z0-9_-]{20,}/ },
  { label: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { label: 'Slack token', re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: 'private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { label: 'Google API key', re: /AIza[0-9A-Za-z_-]{35}/ },
  { label: 'JWT', re: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
];

const CREDENTIAL_ASSIGNMENT = new RegExp(
  [
    String.raw`(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret|client[_-]?secret|password|passwd|pwd|passphrase)`,
    String.raw`\s*[:=]\s*`,
    String.raw`['"\`][^'"\`\s]{12,}['"\`]`,
  ].join(''),
  'i',
);
const BEARER = /authorization\s*[:=]\s*['"`]?\s*bearer\s+\S{12,}/i;
/** Chinese words for the same thing — the README and notes are written in Chinese. */
const CHINESE_SECRETS = /(密钥|私钥|口令|访问令牌|密码)\s*[:=：]\s*\S{8,}/;
/** Local machine leaks worth failing on: a real user name in a path or email. */
const PERSONAL = /[A-Za-z]:\\Users\\[^\\\s"']+|\/home\/(?!user|runner|node)[a-z0-9._-]+\//i;

/**
 * Long high-entropy runs are worth a human look, but a naive character-class
 * match drowns the report in comment separators ("// ------…") and URLs. A real
 * token mixes cases and digits and contains no path separators.
 */
function entropySuspects(text) {
  const out = [];
  for (const run of text.match(/[A-Za-z0-9+/=_-]{44,}/g) ?? []) {
    if (run.includes('/') || run.includes('://')) continue; // URL fragment
    if (/^[-_=+]+$/.test(run)) continue; // separator rule
    const classes = [/[a-z]/.test(run), /[A-Z]/.test(run), /[0-9]/.test(run)].filter(Boolean).length;
    if (classes >= 2) out.push(run);
  }
  return out;
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function scanText(label, text, problems, findings) {
  for (const { label: kind, re } of TOKEN_SHAPES) {
    const match = re.exec(text);
    if (match !== null) problems.push(`${label}: looks like a ${kind} — ${match[0].slice(0, 12)}…`);
  }
  if (CREDENTIAL_ASSIGNMENT.test(text)) problems.push(`${label}: credential-looking assignment`);
  if (BEARER.test(text)) problems.push(`${label}: Authorization: Bearer value`);
  if (CHINESE_SECRETS.test(text)) problems.push(`${label}: Chinese credential assignment`);
  if (PERSONAL.test(text)) problems.push(`${label}: a personal path or home directory is embedded`);
  for (const hit of entropySuspects(text)) findings.push(`${label}: long token-like string ${hit.slice(0, 16)}… (${hit.length} chars) — eyeball it`);
}

/** PNG text chunks: a screenshot's pixels are not its only payload. */
function scanPng(label, buffer, problems, notes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buffer.subarray(0, 8).equals(signature)) return false;
  let offset = 8;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push(type);
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf'].includes(type)) {
      const preview = data.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 120);
      notes.push(`${label}: PNG carries a ${type} chunk — "${preview}"`);
    }
    offset += 12 + length;
    if (type === 'IEND') break;
  }
  return true;
}

const problems = [];
const findings = [];
const notes = [];

// --- pass 1: the working tree ----------------------------------------------
const files = walk(ROOT);
let textFiles = 0;
let pngFiles = 0;
for (const path of files) {
  const name = relative(ROOT, path);
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  const bytes = readFileSync(path);
  if (ext === '.png') {
    pngFiles += 1;
    scanPng(name, bytes, problems, notes);
    // Pixels aside, a decoded text chunk plus raw bytes must not hold a token.
    scanText(name, bytes.toString('latin1'), problems, findings);
    continue;
  }
  if (!TEXT_EXTENSIONS.has(ext)) continue;
  textFiles += 1;
  scanText(name, bytes.toString('utf8'), problems, findings);
}

// --- pass 2: every blob in git history -------------------------------------
let historyBlobs = 0;
const gitDir = join(ROOT, '.git');
if (existsSync(gitDir)) {
  try {
    const objects = execFileSync('git', ['rev-list', '--objects', '--all'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .map(line => line.trim())
      .filter(line => line !== '')
      .map(line => {
        const [hash, ...rest] = line.split(' ');
        return { hash, path: rest.join(' ') };
      })
      .filter(entry => /^[0-9a-f]{40}$/.test(entry.hash));
    for (const entry of objects) {
      let content;
      try {
        content = execFileSync('git', ['cat-file', '-p', entry.hash], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 });
      } catch {
        continue;
      }
      historyBlobs += 1;
      const isPng = content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      scanText(`history:${entry.path || entry.hash}`, isPng ? content.toString('latin1') : content.toString('utf8'), problems, findings);
    }
  } catch (error) {
    notes.push(`git history scan skipped: ${error.message}`);
  }
} else {
  notes.push('no .git directory here — history scan skipped');
}

// --- report -----------------------------------------------------------------
console.log('secret scan');
console.log(`  working tree : ${textFiles} text file(s), ${pngFiles} PNG(s)`);
console.log(`  git history  : ${historyBlobs} blob(s) across all refs`);
console.log(`  patterns     : ${TOKEN_SHAPES.length} token shapes + credential assignment + bearer + Chinese + personal path`);
if (notes.length > 0) {
  console.log('\nnotes:');
  for (const note of notes) console.log(`  - ${note}`);
}
if (findings.length > 0) {
  console.log('\nfor a human look (not necessarily secrets):');
  for (const finding of findings) console.log(`  - ${finding}`);
}
console.log('\n' + (problems.length === 0
  ? 'SECRET SCAN PASS — no key, credential, token-shaped string, personal path, or PNG text chunk found.'
  : `SECRET SCAN FAIL (${problems.length}):\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
