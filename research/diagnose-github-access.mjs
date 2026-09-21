/**
 * Follow-up: compare the two egress paths properly and look for the abuse-page
 * marker, so the answer is "this path is flagged", not "probably the proxy".
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const PROXY = 'http://127.0.0.1:7890';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const require = createRequire(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), '@deepseek-ai/dsh', 'lib', 'bin.js'));
const undici = await import(pathToFileURL(require.resolve('undici')).href);
const agent = new undici.ProxyAgent(PROXY);
console.log(`proxy agent ready: ${PROXY}\n`);

async function probe(url, { viaProxy, ua }) {
  const init = {
    signal: AbortSignal.timeout(15_000),
    redirect: 'manual',
    headers: ua === undefined ? {} : { 'user-agent': ua },
  };
  try {
    let response;
    if (viaProxy) {
      // Same lesson as the plugin: the agent and the fetch must come from the
      // SAME undici copy, or the request dies with UND_ERR_INVALID_ARG.
      init.dispatcher = agent;
      response = await undici.fetch(url, init);
    } else {
      response = await fetch(url, init);
    }
    const text = await response.text();
    const abuse = /Access temporarily restricted|访问暂时受限|abuse detection|与网路机器人相同|与网络机器人相同/.test(text);
    const title = /<title>([^<]*)<\/title>/i.exec(text)?.[1]?.trim() ?? '';
    const marker = /Attention Required|Sorry, you have been blocked|cf-error|Cloudflare|Just a moment/i.test(text) ? '  <-- CLOUDFLARE/blocked' : '';
    return `${response.status}${abuse ? '  <-- ABUSE PAGE' : ''}${marker}  (${text.length}b) ${title}`;
  } catch (error) {
    return `FAILED (${error?.cause?.code ?? error?.name ?? error})`;
  }
}

const targets = [
  ['github.com/login', 'https://github.com/login'],
  ['github.com/signup', 'https://github.com/signup'],
  ['api.github.com/rate_limit', 'https://api.github.com/rate_limit'],
  ['npmjs.com/signup', 'https://www.npmjs.com/signup'],
  ['registry.npmjs.org', 'https://registry.npmjs.org/-/ping'],
];

for (const [label, url] of targets) {
  console.log(label);
  console.log(`   direct            : ${await probe(url, { viaProxy: false })}`);
  console.log(`   direct + browserUA: ${await probe(url, { viaProxy: false, ua: BROWSER_UA })}`);
  console.log(`   via 7890          : ${await probe(url, { viaProxy: true })}`);
  console.log(`   via 7890 + UA     : ${await probe(url, { viaProxy: true, ua: BROWSER_UA })}`);
}
