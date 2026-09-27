/**
 * One command to answer "is this machine about to corrupt a file, and did
 * anything already get corrupted?"
 *
 * It exists because the two failure modes hit here come from the ENVIRONMENT, not
 * from any one project:
 *   1. a shell that reads/writes non-ASCII text through the system code page
 *      (Windows PowerShell 5.1 reads BOM-less UTF-8 as GBK, and its
 *      `-Encoding UTF8` WRITES a BOM — which is how a .cmd shim starts printing
 *      "锘緼ECHO off"), and
 *   2. generated launcher shims that nobody reviews, so a BOM reappears every time
 *      a package manager regenerates them.
 *
 * Output is intentionally ASCII so it stays readable in a GBK console; the files
 * it inspects are still read byte-for-byte.
 *
 *   node research/doctor.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BOM = [0xef, 0xbb, 0xbf];
const hasBom = bytes => bytes !== null && bytes.length >= 3 && BOM.every((byte, i) => bytes[i] === byte);
const problems = [];
const notes = [];

console.log('=== environment ===');
console.log(`node              : ${process.version} (${process.platform})`);

// The console code page decides whether a correctly-encoded file LOOKS garbled.
const chcp = spawnSync('cmd', ['/c', 'chcp'], { encoding: 'utf8' });
const codePage = /(\d{3,5})/.exec(chcp.stdout ?? '');
console.log(`console code page : ${codePage === null ? '(unknown)' : codePage[1]}${codePage !== null && codePage[1] !== '65001' ? '  (not UTF-8: correct files can still LOOK garbled here)' : ''}`);
if (codePage !== null && codePage[1] !== '65001') notes.push('run `chcp 65001` in a console before trusting what Chinese text looks like in it');

console.log('\n=== shells that can rewrite your files ===');
const dir = mkdtempSync(join(tmpdir(), 'dsh-doctor-'));
const sample = '\u4e2d\u6587\u6d4b\u8bd5';
for (const exe of ['powershell', 'pwsh']) {
  const probe = spawnSync(exe, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
  if (probe.error !== undefined || probe.status !== 0) {
    console.log(`${exe.padEnd(11)}: not available`);
    continue;
  }
  const version = String(probe.stdout ?? '').trim();
  const plain = join(dir, `${exe}-setcontent.txt`);
  spawnSync(exe, ['-NoProfile', '-Command', `Set-Content -LiteralPath '${plain}' -Value '${sample}' -Encoding UTF8`], { encoding: 'utf8' });
  const plainBytes = existsSync(plain) ? readFileSync(plain) : null;
  const writesBom = hasBom(plainBytes);
  // The .NET call is the BOM-less escape hatch; it fails under ConstrainedLanguage.
  const safe = join(dir, `${exe}-net.txt`);
  const safeRun = spawnSync(exe, ['-NoProfile', '-Command', `[System.IO.File]::WriteAllText('${safe}', '${sample}', (New-Object System.Text.UTF8Encoding $false))`], { encoding: 'utf8' });
  const safeBytes = existsSync(safe) ? readFileSync(safe) : null;
  const safeOk = safeBytes !== null && !hasBom(safeBytes) && safeBytes.length > 0;
  console.log(`${exe.padEnd(11)}: ${version}`);
  console.log(`              Set-Content -Encoding UTF8 writes a BOM : ${writesBom ? 'YES  <-- do not use it on source files' : 'no'}`);
  console.log(`              [System.IO.File]::WriteAllText BOM-less : ${safeOk ? 'works (use this)' : `failed${safeRun.stderr ? `: ${String(safeRun.stderr).trim().split('\n')[0]}` : ''}`}`);
  if (writesBom && !safeOk) problems.push(`${exe} can only write a BOM (or nothing) — write files from Node instead`);
  if (writesBom) notes.push(`${exe}: prefer node -e "fs.writeFileSync(p, s, 'utf8')" over Set-Content for anything containing non-ASCII`);
}
rmSync(dir, { recursive: true, force: true });

console.log('\n=== launcher shims (.cmd/.bat/.ps1) ===');
const shim = spawnSync(process.execPath, [new URL('./scan-shim-encoding.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
const shimLines = String(shim.stdout ?? '').trim().split('\n');
console.log(shimLines.filter(line => /SHIM SCAN|to fix|should STAY/.test(line)).map(line => `  ${line.trim()}`).join('\n') || '  (no output)');
if (shim.status !== 0) problems.push('a .cmd/.bat shim carries a BOM (cmd.exe prints "锘緼ECHO off") — .ps1 BOMs are correct and are not reported here');

console.log('\n=== this repository ===');
const repo = new URL('../tests/encoding-check.mjs', import.meta.url);
const check = spawnSync(process.execPath, [repo.pathname.replace(/^\/([A-Za-z]:)/, '$1')], { encoding: 'utf8' });
console.log(`encoding-check    : ${String(check.stdout ?? '').trim().split('\n').slice(-1)[0] ?? '(no output)'}`);
if (check.status !== 0) problems.push('the repository itself failed its encoding guard');

console.log(`\n${problems.length === 0 ? 'DOCTOR: nothing to fix' : `DOCTOR: ${problems.length} thing(s) to fix`}`);
for (const problem of problems) console.log(`  ! ${problem}`);
if (notes.length > 0) {
  console.log('\nhabits worth keeping:');
  for (const note of notes) console.log(`  - ${note}`);
}
process.exitCode = problems.length === 0 ? 0 : 1;
