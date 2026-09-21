// Connectivity probe: npm registry vs GitHub, using Node's own fetch (undici).
const endpoints = [
  ['npm-official', 'https://registry.npmjs.org/@deepseek-ai%2Fdsh'],
  ['npm-mirror  ', 'https://registry.npmmirror.com/@deepseek-ai/dsh'],
  ['gh-api      ', 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1'],
  ['gh-raw      ', 'https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/master/package.json'],
  ['gh-web      ', 'https://github.com/deepseek-ai/deepseek-harness'],
];

async function attempt(url, timeoutMs = 8000) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'dsh-update-probe', accept: 'application/json' },
      redirect: 'follow',
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bytes: text.length, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.cause?.code || error?.name || error), ms: Date.now() - started };
  }
}

for (const [name, url] of endpoints) {
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push(await attempt(url));
  const okCount = results.filter(r => r.ok).length;
  const detail = results.map(r => r.ok ? `OK/${r.status}/${r.bytes}b/${r.ms}ms` : `${r.error}/${r.ms}ms`).join('  ');
  console.log(`${name} ${okCount}/3   ${detail}`);
}

// Report the version facts the plugin will rely on.
const meta = await (await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', { signal: AbortSignal.timeout(15000) })).json();
console.log('\ndist-tags:', JSON.stringify(meta['dist-tags']));
const versions = Object.keys(meta.versions);
console.log('newest published:', versions[versions.length - 1]);
