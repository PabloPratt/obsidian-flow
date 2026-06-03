/**
 * Test runner — no external framework needed.
 * Tests every agent and provider for real connectivity.
 * Run: node tests/run.js
 */

import 'dotenv/config';

let passed = 0, failed = 0, skipped = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function test(name, fn, { skip = false } = {}) {
  if (skip) {
    console.log(`  ⏭  ${name}`);
    skipped++;
    return;
  }
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}\n     ${e.message}`);
    failed++;
  }
}

async function suite(name, fn) {
  console.log(`\n${name}`);
  await fn();
}

// ─────────────────────────────────────────────────────────────────────────────

await suite('Providers', async () => {
  await test('Anthropic key configured', () => {
    assert(process.env.ANTHROPIC_API_KEY, 'ANTHROPIC_API_KEY not set');
  });
  await test('OpenAI key configured', () => {
    assert(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY not set');
  });
  await test('Gemini key configured', () => {
    assert(process.env.GEMINI_API_KEY, 'GEMINI_API_KEY not set');
  });
  await test('Provider list shows all active', async () => {
    const { listProviders } = await import('../src/providers.js');
    const providers = listProviders();
    const active = providers.filter(p => p.active);
    assert(active.length === 3, `Expected 3 active providers, got ${active.length}: ${providers.map(p=>p.name+':'+p.active).join(', ')}`);
  });
});

await suite('Options Flow (Unusual Whales)', async () => {
  await test('Fetches flow alerts', async () => {
    const { fetchOptionsFlow } = await import('../src/agents/options-flow.js');
    const result = await fetchOptionsFlow({ minPremium: 100_000, limit: 5 });
    assert(result.source === 'unusual_whales', 'Wrong source');
    assert(Array.isArray(result.signals), 'signals not an array');
    assert(result.signals.length > 0, 'No signals returned');
    assert(result.signals[0].ticker, 'Missing ticker');
    assert(result.signals[0].premium > 0, 'Missing premium');
  });
});

await suite('Options Chain (Yahoo Finance)', async () => {
  await test('Fetches live bid/ask for SPY', async () => {
    const { fetchChain, fetchExpiries } = await import('../src/agents/options-chain.js');
    const expiries = await fetchExpiries('SPY');
    const nextExpiry = expiries.find(d => d > new Date().toISOString().slice(0,10));
    assert(nextExpiry, 'No future expiry dates found for SPY');
    const contracts = await fetchChain('SPY', nextExpiry, 'calls', 200, 0);
    assert(contracts.length > 0, 'No SPY calls returned');
    assert(contracts[0].bid >= 0, 'Missing bid');
    assert(contracts[0].ask > 0, 'Missing ask');
    assert(contracts[0].volume >= 0, 'Missing volume');
  });
  await test('Prices a specific contract', async () => {
    const { priceContract } = await import('../src/agents/options-chain.js');
    // SPY is always liquid — pick a far-future date so the contract exists
    const result = await priceContract('SPY260918C00800000');
    // May return null if not found but should not throw
    assert(result === null || result.ask >= 0, 'Invalid price result');
  });
});

await suite('NASA EONET', async () => {
  await test('Fetches natural events', async () => {
    const { fetchNASAEvents } = await import('../src/agents/nasa.js');
    try {
      const result = await fetchNASAEvents({ daysBack: 14 });
      assert(result.source === 'nasa_eonet', 'Wrong source');
      assert(typeof result.totalEvents === 'number', 'Missing totalEvents');
      assert(Array.isArray(result.signals), 'signals not array');
    } catch (e) {
      if (e.message.includes('503') || e.message.includes('502') || e.message.includes('504')) {
        console.log('     ⚠  NASA EONET is temporarily down (server-side) — skipping');
        skipped++; passed--; // rebalance counters
        return;
      }
      throw e;
    }
  });
});

await suite('ADS-B (OpenSky)', async () => {
  await test('Fetches flight data', async () => {
    const { fetchADSBData } = await import('../src/agents/adsb.js');
    const result = await fetchADSBData({ region: 'continental_us', aircraftType: 'all' });
    assert(result.source === 'opensky_adsb', 'Wrong source');
    assert(result.summary.totalAirborne >= 0, 'Missing totalAirborne');
    assert(Array.isArray(result.flights), 'flights not array');
  });
});

await suite('US Government Spending', async () => {
  await test('Fetches contract awards', async () => {
    const { fetchGovernmentSpending } = await import('../src/agents/spending.js');
    const result = await fetchGovernmentSpending({ minAmount: 1_000_000, daysBack: 7 });
    assert(result.source === 'usa_spending', 'Wrong source');
    assert(Array.isArray(result.contracts), 'contracts not array');
    assert(typeof result.totalValue === 'number', 'Missing totalValue');
  });
});

await suite('SEC EDGAR', async () => {
  await test('Fetches recent filings', async () => {
    const { fetchSECFilings } = await import('../src/agents/sec-edgar.js');
    const result = await fetchSECFilings({ daysBack: 7 });
    assert(result.source === 'sec_edgar', 'Wrong source');
    assert(result.ipos, 'Missing ipos');
    assert(result.materialEvents, 'Missing materialEvents');
  });
});

await suite('Clinical Trials', async () => {
  await test('Fetches Phase 3 completions', async () => {
    const { fetchClinicalTrials } = await import('../src/agents/clinical-trials.js');
    const result = await fetchClinicalTrials({ phase: 'PHASE3', status: 'COMPLETED', daysBack: 30 });
    assert(result.source === 'clinicaltrials_gov', 'Wrong source');
    assert(Array.isArray(result.trials), 'trials not array');
  });
});

await suite('arXiv', async () => {
  await test('Fetches AI papers', async () => {
    const { fetchArxivSignals } = await import('../src/agents/arxiv.js');
    const result = await fetchArxivSignals({ categories: ['cs.AI'], maxPerCategory: 3 });
    assert(result.source === 'arxiv', 'Wrong source');
    assert(result.totalPapers > 0, 'No papers returned');
    assert(result.papers[0].title, 'Missing title');
  });
});

await suite('FDA', async () => {
  await test('Fetches drug approvals and recalls', async () => {
    const { fetchFDASignals } = await import('../src/agents/fda.js');
    const result = await fetchFDASignals({ daysBack: 30 });
    assert(result.source === 'openfda', 'Wrong source');
    assert(result.approvals, 'Missing approvals');
    assert(result.recalls, 'Missing recalls');
  });
});

await suite('FRED (Macro)', async () => {
  await test('Fetches economic indicators', async () => {
    const { fetchFREDSignals } = await import('../src/agents/fred.js');
    const result = await fetchFREDSignals();
    assert(result.source === 'fred', 'Wrong source');
    if (!result.configured) { console.log('     ⚠  FRED key not set — skipping data checks'); return; }
    assert(result.macroRegime, 'Missing macroRegime');
    assert(result.indicators, 'Missing indicators');
  });
});

await suite('EIA (Energy)', async () => {
  await test('Fetches energy inventory data', async () => {
    const { fetchEIASignals } = await import('../src/agents/eia.js');
    const result = await fetchEIASignals();
    assert(result.source === 'eia', 'Wrong source');
    if (!result.configured) { console.log('     ⚠  EIA key not set — skipping data checks'); return; }
    assert(result.indicators, 'Missing indicators');
  });
});

await suite('News', async () => {
  await test('Fetches headlines (HN fallback)', async () => {
    const { fetchNewsSignals } = await import('../src/agents/news.js');
    const result = await fetchNewsSignals({ query: 'technology stocks', tickers: ['NVDA', 'AMD'] });
    assert(['newsapi', 'hacker_news'].includes(result.source), 'Unknown source');
    assert(typeof result.articleCount === 'number', 'Missing articleCount');
    assert(Array.isArray(result.articles), 'articles not array');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed · ${failed} failed · ${skipped} skipped`);
if (failed > 0) process.exit(1);
