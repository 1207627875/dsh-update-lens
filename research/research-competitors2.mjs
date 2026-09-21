/**
 * Retry the READMEs that failed transiently, and pull the remaining close
 * competitors' feature lists.
 */
const REPOS = [
  ['Airmetro/dsh-update-checker', 2600],
  ['stuarthu/dsh-update-notifier', 1400],
  ['onewilk/dsh-updater', 1400],
  ['LX2000WASD/dsh-web-plugin-manager', 1400],
  ['nmbzth/dsh_update_check', 0],
];

async function get(url, attempts = 4) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      const response = await fetch(url, { headers: { 'user-agent': 'dsh-research' }, signal: AbortSignal.timeout(25_000) });
      if (response.status === 404) return { status: 404, text: '' };
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return { status: response.status, text: await response.text() };
    } catch (error) {
      if (i === attempts) return { status: 0, error: String(error?.cause?.code ?? error?.name ?? error), text: '' };
      await new Promise(r => setTimeout(r, 800));
    }
  }
}

for (const [repo, budget] of REPOS) {
  console.log(`\n${'='.repeat(72)}\n## ${repo}`);
  const meta = await get(`https://api.github.com/repos/${repo}`);
  if (meta.status !== 200) { console.log(`repo meta failed: ${meta.error ?? meta.status}`); continue; }
  const info = JSON.parse(meta.text);
  console.log(`stars=${info.stargazers_count} lang=${info.language} pushed=${info.pushed_at.slice(0, 10)} branch=${info.default_branch}`);
  console.log(`desc: ${(info.description || '').replace(/\s+/g, ' ')}`);
  for (const file of ['README.md', 'README.zh-CN.md']) {
    const readme = await get(`https://raw.githubusercontent.com/${repo}/${info.default_branch}/${file}`);
    if (readme.status !== 200 || readme.text.length === 0) { console.log(`  ${file}: ${readme.error ?? readme.status}`); continue; }
    console.log(`  ${file}: ${readme.text.length} chars`);
    if (budget > 0) console.log(readme.text.slice(0, budget));
    break;
  }
}
