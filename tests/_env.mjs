/**
 * Shared environment lookup for the tests.
 *
 * Nothing here may hard-code a machine: a published repo has to run on someone
 * else's box. Everything falls back to the conventional location and reports a
 * clean skip when the dsh installation cannot be found.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** $DSH_HOME, else the conventional ~/.dsh. */
export function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : '';
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh');
}

/** The profile under $DSH_HOME/profiles that the tests inspect. */
export function profileName() {
  const fromEnv = typeof process.env.DSH_PROFILE === 'string' ? process.env.DSH_PROFILE.trim() : '';
  return fromEnv !== '' ? fromEnv : 'web';
}

/**
 * The `dsh` CLI entry the Host runs from — what the plugin reads to learn its own
 * version. `DSH_CLI_BIN` overrides; otherwise the global npm root is asked.
 * @returns the absolute path, or null when it cannot be located.
 */
export function findCliBin() {
  const explicit = typeof process.env.DSH_CLI_BIN === 'string' ? process.env.DSH_CLI_BIN.trim() : '';
  if (explicit !== '') return existsSync(explicit) ? explicit : null;
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const candidate = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js');
    return existsSync(candidate) ? candidate : null;
  } catch {
    return null;
  }
}
