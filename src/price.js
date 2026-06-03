/**
 * Usage:
 *   node src/price.js DVN 2026-07-17 calls 100      → all DVN calls under $100 expiring Jul17
 *   node src/price.js DVN260717C00052500              → price one specific contract
 *   node src/price.js scan AMD,NVDA,META 100          → cheap options scan across tickers
 */

import { fetchChain, priceContract, scanForCheapOptions } from './agents/options-chain.js';

const [,, ...args] = process.argv;

function printContract(c) {
  const itm = c.inTheMoney ? ' [ITM]' : '';
  console.log(
    `  ${c.symbol}${itm}\n` +
    `  ${c.type} $${c.strike} · exp ${c.expiry}\n` +
    `  bid: $${c.bid ?? '—'}  ask: $${c.ask ?? '—'}  last: $${c.last ?? '—'}\n` +
    `  💰 $${c.costPerContract}/contract   vol: ${c.volume.toLocaleString()}   OI: ${c.oi.toLocaleString()}   IV: ${c.iv}%\n`
  );
}

if (args[0] === 'scan') {
  const tickers = (args[1] ?? '').split(',').map(t => t.trim().toUpperCase()).filter(Boolean);
  const budget  = Number(args[2] ?? 100);
  console.log(`\nScanning ${tickers.join(', ')} for options under $${budget}/contract...\n`);
  const results = await scanForCheapOptions(tickers, { budget, minVolume: 50 });
  if (!results.length) { console.log('No results found.'); process.exit(0); }
  results.slice(0, 20).forEach(printContract);

} else if (args[0]?.match(/^[A-Z]+\d{6}[CP]\d{8}$/)) {
  // OCC symbol
  const contract = await priceContract(args[0]);
  if (!contract) { console.log('Contract not found.'); process.exit(1); }
  printContract(contract);

} else {
  const [ticker, expiry, side = 'both', budget = '100'] = args;
  if (!ticker || !expiry) {
    console.log('Usage:\n  node src/price.js TICKER YYYY-MM-DD [calls|puts|both] [maxCost]\n  node src/price.js OCC_SYMBOL\n  node src/price.js scan TICK1,TICK2 [maxCost]');
    process.exit(1);
  }
  console.log(`\n${ticker} ${side} · ${expiry} · under $${budget}/contract\n`);
  const results = await fetchChain(ticker.toUpperCase(), expiry, side, Number(budget), 0);
  if (!results.length) { console.log('No contracts found under that price.'); process.exit(0); }
  results.forEach(printContract);
}
