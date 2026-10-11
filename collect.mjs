// Daily collector. Node 20+, zero dependencies. Free public APIs only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const D = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const rd = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch { return def; } };
const CAT = rd('metrics.json', { metrics: [] }).metrics;
const H = rd('history.json', {}); H.metrics ??= {}; H.errors = {};
const today = new Date().toISOString().slice(0, 10);
const iso = ts => new Date(ts * 1000).toISOString().slice(0, 10);
const byDate = (a, b) => (a[0] < b[0] ? -1 : 1);

const get = async u => {
  const r = await fetch(u, { headers: { 'user-agent': 'eth-thesis-monitor/1.0', accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${u}`);
  return r.json();
};
// merge [date, value] pairs into history (same date = overwrite)
const put = (id, pairs) => {
  const m = new Map(H.metrics[id] || []);
  for (const [d, v] of pairs) if (Number.isFinite(v)) m.set(d, v);
  H.metrics[id] = [...m].sort(byDate).slice(-800);
};
const last = id => (H.metrics[id] || []).at(-1)?.[1];
const upTo = (arr, d) => { let v; for (const [x, y] of arr) { if (x <= d) v = y; else break; } return v; };
// one failing source never stops the others
const run = async (name, fn) => {
  try { await fn(); } catch (e) { H.errors[name] = String(e.message || e).slice(0, 200); console.error('FAIL', name, '-', e.message); }
};

// ETH price (90d history) + circulating supply
await run('price', async () => {
  const j = await get('https://api.coingecko.com/api/v3/coins/ethereum/market_chart?vs_currency=usd&days=90&interval=daily');
  put('p1', j.prices.map(([t, v]) => [iso(t / 1000), v]));
  const c = await get('https://api.coingecko.com/api/v3/coins/ethereum?localization=false&tickers=false&community_data=false&developer_data=false');
  put('p2', [[today, c.market_data.circulating_supply]]);
});

// Stablecoins: total, Ethereum, Solana (full history from DefiLlama)
await run('stablecoins', async () => {
  const sc = a => a.map(x => [iso(+x.date), x.totalCirculatingUSD?.peggedUSD ?? x.totalCirculating?.peggedUSD]).filter(p => p[1] > 0);
  const [all, eth, sol] = await Promise.all(['all', 'Ethereum', 'Solana'].map(c => get(`https://stablecoins.llama.fi/stablecoincharts/${c}`).then(sc)));
  put('s1', all); put('s3', eth); put('c1', sol);
  const t = new Map(all);
  put('s2', eth.filter(([d]) => t.has(d)).map(([d, v]) => [d, v / t.get(d) * 100]));
});

// Ethereum share of total DeFi TVL (full history)
await run('tvl', async () => {
  const [all, eth] = await Promise.all(['', '/Ethereum'].map(s => get('https://api.llama.fi/v2/historicalChainTvl' + s).then(a => a.map(x => [iso(x.date), x.tvl]))));
  const t = new Map(all);
  put('c2', eth.filter(([d]) => t.get(d) > 0).map(([d, v]) => [d, v / t.get(d) * 100]));
});

// Ethereum network fees per day (USD): free proxy for fee demand / burn
await run('fees', async () => {
  const j = await get('https://api.llama.fi/overview/fees/Ethereum?excludeTotalDataChartBreakdown=true&dataType=dailyFees');
  put('v1', (j.totalDataChart || []).map(([t, v]) => [iso(t), v]).filter(([d]) => d < today));
});

// Tokenised real-world assets (DefiLlama "RWA" category): snapshot, history builds daily
await run('rwa', async () => {
  let e = 0, t = 0;
  for (const x of await get('https://api.llama.fi/protocols')) {
    if (x.category !== 'RWA') continue;
    if (typeof x.tvl === 'number') t += x.tvl;
    if (typeof x.chainTvls?.Ethereum === 'number') e += x.chainTvls.Ethereum;
  }
  if (!t) throw new Error('no RWA data');
  put('t1', [[today, e]]); put('t2', [[today, e / t * 100]]);
});

// Ethereum L2 TVL: snapshot
await run('l2', async () => {
  const L2 = ['Base', 'Arbitrum', 'OP Mainnet', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Starknet', 'Blast', 'Mantle'];
  const s = (await get('https://api.llama.fi/v2/chains')).filter(x => L2.includes(x.name)).reduce((a, x) => a + x.tvl, 0);
  if (!s) throw new Error('no L2 data');
  put('c3', [[today, s]]);
});

// Solana DEX volume as % of Ethereum: snapshot
await run('dex', async () => {
  const q = c => get(`https://api.llama.fi/overview/dexs/${c}?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true`).then(j => j.total24h);
  const [s, e] = await Promise.all([q('Solana'), q('Ethereum')]);
  put('c4', [[today, s / e * 100]]);
});

// Staked share = beacon-chain validator balance / circulating supply
await run('staking', async () => {
  const j = await get('https://beaconcha.in/api/v1/epoch/latest');
  const staked = j.data.totalvalidatorbalance / 1e9, sup = last('p2');
  if (!(staked > 0 && sup > 0)) throw new Error('missing staking/supply data');
  put('v2', [[today, staked / sup * 100]]);
});

// Net supply growth, computed from our own supply history (needs 7+ days)
await run('issuance', async () => {
  const s = H.metrics.p2 || [], n = s.at(-1);
  if (!n) return;
  const o = [...s].reverse().find(([d]) => (Date.parse(n[0]) - Date.parse(d)) / 864e5 >= 7);
  if (!o) return;
  const days = (Date.parse(n[0]) - Date.parse(o[0])) / 864e5;
  put('v3', [[n[0], (n[1] / o[1] - 1) * 365 / days * 100]]);
});

// Manual inputs (data/manual.json) + BMNR ratios
await run('manual', async () => {
  const M = rd('manual.json', {}).series || {};
  const g = id => [...(M[id] || [])].sort(byDate);
  for (const c of CAT) if (g(c.id).length) put(c.id, g(c.id).map(([d, v]) => [d, v * (c.div || 1)]));
  for (const [d, h] of g('b1')) {
    const sh = upTo(g('b4'), d), px = upTo(g('b5'), d), ep = upTo(H.metrics.p1 || [], d);
    if (sh > 0) {
      put('b2', [[d, h / sh * 1000]]);                              // ETH per 1,000 diluted shares
      if (px > 0 && ep > 0) put('b3', [[d, px * sh / (h * ep)]]);   // mNAV = equity value / ETH value
    }
  }
});

// Alerts (optional phone push via free ntfy.sh: set the NTFY_TOPIC secret)
const hits = CAT.filter(c => c.op && last(c.id) != null).filter(c => {
  const v = last(c.id) / (c.div || 1);
  return c.op === '<' ? v < c.val : v > c.val;
});
H.updated = new Date().toISOString();
H.alerts = hits.map(c => c.id);
fs.writeFileSync(path.join(D, 'history.json'), JSON.stringify(H));
console.log('done; errors:', Object.keys(H.errors).length, 'alerts:', hits.length);
if (process.env.NTFY_TOPIC && hits.length) {
  await fetch('https://ntfy.sh/' + process.env.NTFY_TOPIC, {
    method: 'POST', headers: { Title: 'ETH thesis alert' },
    body: hits.map(c => `${c.name}: ${(last(c.id) / (c.div || 1)).toFixed(c.d)} (${c.op} ${c.val})`).join('\n'),
  }).catch(() => {});
}
