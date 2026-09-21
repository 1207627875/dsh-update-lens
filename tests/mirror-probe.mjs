/**
 * Re-tests the GitHub API and its common public mirrors with Node's own fetch
 * (which ignores the WinINET system proxy). The earlier PowerShell run was
 * confounded: .NET honours the per-user proxy at 127.0.0.1:7890, so a mirror
 * failure there said nothing about the mirror itself.
 */
const target = 'https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=1';
const candidates = [
  ['direct            ', target],
  ['gh-proxy.com      ', `https://gh-proxy.com/${target}`],
  ['ghfast.top        ', `https://ghfast.top/${target}`],
  ['ghproxy.net       ', `https://ghproxy.net/${target}`],
  ['hub.gitmirror.com ', `https://hub.gitmirror.com/${target}`],
  ['api.kkgithub.com  ', target.replace('api.github.com', 'api.kkgithub.com')],
  ['ghapi.handy.tools ', `https://ghapi.handy.tools/${target}`],
  ['gh.llkk.cc        ', `https://gh.llkk.cc/${target}`],
];

async function probe(url) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'user-agent': 'dsh-update-lens-probe', accept: 'application/json' },
    });
    const text = await response.text();
    const valid = /tag_name/.test(text);
    return { ok: response.ok && valid, status: response.status, bytes: text.length, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, status: 0, error: String(error?.cause?.code ?? error?.name ?? error), ms: Date.now() - started };
  }
}

for (const [name, url] of candidates) {
  const results = [];
  for (let i = 0; i < 2; i += 1) results.push(await probe(url));
  const summary = results.map(r => (r.ok ? `OK ${r.ms}ms` : `FAIL ${r.error ?? r.status} ${r.ms}ms`)).join(' | ');
  console.log(`${name} ${summary}`);
}
