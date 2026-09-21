/**
 * Verify what is ACTUALLY on GitHub — not what the working tree says.
 *
 * Downloads the repository tarball, unpacks it, runs the secret scan inside the
 * unpacked copy, and compares every file's SHA-256 against the local tree. This
 * is the only check that can answer "is anything of mine on the remote?" without
 * trusting git status, the index, or a previous push.
 *
 * Two PowerShell traps this exists to avoid:
 *   - `gh api ... > file.tgz` writes UTF-16 text and mangles the archive, so the
 *     download is done in Node with an explicit Buffer.
 *   - `tar -xzf C:\...` makes MSYS tar treat the drive letter as a remote host,
 *     so extraction runs from inside the temp directory with a relative name.
 *
 *   node research/verify-remote.mjs [owner/repo] [branch]
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOCAL_ROOT = fileURLToPath(new URL('../', import.meta.url));
const REPO = process.argv[2] ?? '1207627875/dsh-update-lens';
const BRANCH = process.argv[3] ?? 'main';
const WORK = join(tmpdir(), `dsh-verify-${Date.now()}`);
const SKIP = /(^|\/)(\.git|node_modules)(\/|$)|\.corrupt\.bak$/;

function ghToken() {
  for (const bin of ['gh', 'C:/Program Files/GitHub CLI/gh.exe']) {
    try {
      return execFileSync(bin, ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      /* try the next path */
    }
  }
  return null;
}

function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, base, out);
    else out.push(relative(base, full).replace(/\\/g, '/'));
  }
  return out;
}

const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');

console.log(`remote verify: ${REPO}@${BRANCH}`);
mkdirSync(WORK, { recursive: true });
const problems = [];

try {
  // --- 1. download, binary-safe -------------------------------------------
  const token = ghToken();
  if (token === null) console.log('  note: no gh token available — using the anonymous endpoint (rate limited)');
  const response = await fetch(`https://api.github.com/repos/${REPO}/tarball/${BRANCH}`, {
    headers: {
      'user-agent': 'dsh-remote-verify',
      accept: 'application/vnd.github+json',
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`tarball download failed: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const gzipMagic = archive[0] === 0x1f && archive[1] === 0x8b;
  console.log(`  downloaded ${(archive.length / 1024).toFixed(0)} KB, gzip magic: ${gzipMagic ? 'ok' : 'MISSING'}`);
  if (!gzipMagic) throw new Error('downloaded bytes are not a gzip archive');
  writeFileSync(join(WORK, 'repo.tgz'), archive);

  // --- 2. extract (relative path: MSYS tar chokes on "C:\...") ------------
  execFileSync('tar', ['-xzf', 'repo.tgz'], { cwd: WORK, stdio: 'pipe' });
  const dirs = readdirSync(WORK).filter(name => statSync(join(WORK, name)).isDirectory());
  if (dirs.length !== 1) throw new Error(`expected one extracted directory, found ${dirs.length}`);
  const unpacked = join(WORK, dirs[0]);
  const files = walk(unpacked);
  console.log(`  unpacked ${files.length} file(s) into ${dirs[0]}`);

  // --- 3. secret scan inside the unpacked copy ----------------------------
  // Prefer the scanner that ships in the downloaded copy; fall back to the local
  // one pointed at that directory, so a repo without the scanner still gets scanned.
  const remoteScanner = join(unpacked, 'tests', 'secret-scan.mjs');
  const scanner = existsSync(remoteScanner) ? remoteScanner : join(LOCAL_ROOT, 'tests', 'secret-scan.mjs');
  const scannerArgs = existsSync(remoteScanner) ? [] : ['--root', unpacked];
  try {
    const scan = execFileSync(process.execPath, [scanner, ...scannerArgs], { cwd: unpacked, encoding: 'utf8' });
    const verdict = scan.trim().split('\n').filter(Boolean).pop();
    console.log(`  secret scan on the remote copy (${existsSync(remoteScanner) ? 'its own scanner' : 'local scanner --root'}): ${verdict}`);
    if (!/PASS/.test(verdict)) problems.push('the remote secret scan did not pass');
  } catch (error) {
    problems.push(`remote secret scan failed to run: ${String(error.stdout ?? error.message).slice(0, 200)}`);
  }

  // --- 4. every file byte-identical to the local tree ---------------------
  let same = 0;
  let differs = 0;
  for (const rel of files) {
    if (SKIP.test(rel)) continue;
    const remotePath = join(unpacked, rel);
    const localPath = join(LOCAL_ROOT, rel);
    if (!existsSync(localPath)) {
      differs += 1;
      console.log(`  ONLY-REMOTE: ${rel}`);
      continue;
    }
    if (sha(remotePath) === sha(localPath)) same += 1;
    else {
      differs += 1;
      console.log(`  DIFFERS: ${rel}`);
    }
  }
  const localOnly = walk(LOCAL_ROOT).filter(rel => !SKIP.test(rel) && !existsSync(join(unpacked, rel)));
  console.log(`  byte-identical: ${same} | differing: ${differs} | local-only (not pushed yet): ${localOnly.length}`);
  for (const rel of localOnly) console.log(`    not pushed: ${rel}`);
  if (differs > 0) problems.push(`${differs} file(s) differ between the remote and the local tree`);
} catch (error) {
  problems.push(String(error.message ?? error));
} finally {
  rmSync(WORK, { recursive: true, force: true });
}

console.log('\n' + (problems.length === 0
  ? 'REMOTE VERIFY PASS — the published repository matches this working tree byte for byte, and its secret scan passes.'
  : `REMOTE VERIFY FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
