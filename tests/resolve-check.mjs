/**
 * Resolve check for the plugin's install location.
 *
 * The plugin lives OUTSIDE any workspace, so its survival depends on exactly one
 * link: the profile's node_modules junction. This script resolves the package the
 * same way the Host's client-modules service does on a fresh boot, and prints the
 * client bundle path that a restarted profile will serve. Run it after moving the
 * directory or editing `dsh.client`.
 *
 *   node tests/resolve-check.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

import { dshHome, profileName } from './_env.mjs';

const PROFILE_DIR = join(dshHome(), 'profiles', profileName());
const PACKAGE = 'dsh-update-lens';

const problems = [];
if (!existsSync(join(PROFILE_DIR, 'package.json'))) {
  console.log(`SKIP: no profile at ${PROFILE_DIR} (set DSH_HOME / DSH_PROFILE)`);
  process.exit(0);
}
const require = createRequire(`${PROFILE_DIR}/package.json`);

// 1. the profile declares the link
const profilePkg = JSON.parse(readFileSync(`${PROFILE_DIR}/package.json`, 'utf8'));
const spec = profilePkg.dependencies?.[PACKAGE];
if (typeof spec !== 'string') problems.push(`${PACKAGE} is not a dependency of the profile`);
if (!profilePkg.dsh?.profile?.bundles?.includes(PACKAGE)) problems.push(`${PACKAGE} is missing from dsh.profile.bundles`);
console.log('dependency spec    :', spec);
console.log('in bundles list    :', profilePkg.dsh?.profile?.bundles?.includes(PACKAGE));

// 2. the spec's target exists (link: points at the real directory)
if (typeof spec === 'string' && spec.startsWith('link:')) {
  const target = resolve(spec.slice('link:'.length));
  const exists = existsSync(join(target, 'package.json'));
  console.log('link target        :', target, exists ? '(ok)' : '(MISSING)');
  if (!exists) problems.push(`link target has no package.json: ${target}`);
}

// 3. bare-specifier resolution from the profile reaches the real directory
let manifest = null;
try {
  manifest = require.resolve(`${PACKAGE}/package.json`);
  console.log('resolved manifest  :', manifest);
} catch (error) {
  problems.push(`cannot resolve ${PACKAGE}/package.json from the profile: ${error.code ?? error.message}`);
}
if (manifest !== null) {
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  console.log('manifest name      :', pkg.name, '| version', pkg.version);
  if (pkg.name !== PACKAGE) problems.push(`resolved manifest declares ${pkg.name}, expected ${PACKAGE}`);

  // 4. the client bundle the Host will serve: dirname(manifest) + exports["./client"]
  const clientRel = pkg.exports?.['./client'];
  const clientPath = typeof clientRel === 'string' ? join(dirname(manifest), clientRel) : null;
  const clientOk = clientPath !== null && existsSync(clientPath);
  console.log('dsh.client         :', JSON.stringify(pkg.dsh?.client ?? null));
  console.log('client bundle path :', clientPath, clientOk ? '(ok)' : '(MISSING)');
  if (!clientOk) problems.push(`client bundle not found at ${clientPath}`);
  if (pkg.dsh?.client?.platform !== 'web') problems.push('dsh.client.platform must be "web"');

  // 5. a published bundle must not bake in one machine's paths
  if (clientPath !== null && existsSync(clientPath)) {
    const bundle = readFileSync(clientPath, 'utf8');
    if (/(^|[^a-z])[A-Za-z]:[\\/]/.test(bundle)) problems.push('client bundle contains an absolute Windows path');
    if (bundle.includes('/Users/') || bundle.includes('/home/')) problems.push('client bundle contains an absolute POSIX home path');
    console.log('bundle size        :', bundle.length, 'bytes');
  }
}

console.log('\n' + (problems.length === 0
  ? 'RESOLVE CHECK PASS — a restarted profile will mount this plugin from the path above.'
  : `RESOLVE CHECK FAIL:\n - ${problems.join('\n - ')}`));
process.exitCode = problems.length === 0 ? 0 : 1;
