/**
 * Research helper: find and summarise existing DSH update-check plugins.
 * Uses Node fetch (bypasses the dead system proxy).
 */
const HEADERS = { 'user-agent': 'dsh-research', accept: 'application/vnd.github+json' };

async function json(url) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

async function search(query) {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=15`;
  try {
    const data = await json(url);
    console.log(`\n### search: ${query}  (total ${data.total_count})`);
    for (const item of data.items) {
      console.log(`  ${item.full_name} ★${item.stargazers_count} upd=${item.updated_at.slice(0, 10)} :: ${(item.description || '').replace(/\s+/g, ' ').slice(0, 130)}`);
    }
  } catch (error) {
    console.log(`\n### search: ${query} FAILED ${error.message}`);
  }
}

await search('dsh update check in:name,description,readme');
await search('dsh 更新 in:name,description');
await search('deepseek harness update notifier in:name,description,readme');

const CANDIDATES = [
  'nmbzth/dsh_update_check',
  'onewilk/dsh-updater',
  'AsILAnn/dsh-update-checker',
  'stuarthu/dsh-update-notifier',
  'mzzsfy/dsh-maintain',
];

for (const repo of CANDIDATES) {
  console.log(`\n${'='.repeat(70)}\n## ${repo}`);
  try {
    const meta = await json(`https://api.github.com/repos/${repo}`);
    console.log(`stars=${meta.stargazers_count} forks=${meta.forks_count} lang=${meta.language} license=${meta.license?.spdx_id} created=${meta.created_at.slice(0, 10)} pushed=${meta.pushed_at.slice(0, 10)} branch=${meta.default_branch}`);
    console.log(`desc: ${(meta.description || '').replace(/\s+/g, ' ')}`);
    const topics = meta.topics || [];
    if (topics.length) console.log(`topics: ${topics.join(', ')}`);
    const readmeUrl = `https://raw.githubusercontent.com/${repo}/${meta.default_branch}/README.md`;
    const response = await fetch(readmeUrl, { headers: { 'user-agent': 'dsh-research' }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      console.log(`README: HTTP ${response.status}`);
      continue;
    }
    const text = await response.text();
    console.log(`README ${text.length} chars, first 2000:\n${'-'.repeat(40)}`);
    console.log(text.slice(0, 2000));
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
  }
}
