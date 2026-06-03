/**
 * arXiv agent — scans preprint research for emerging technology signals:
 *  - AI/ML breakthroughs  → NVDA, AMD, MSFT, GOOG, META implications
 *  - Quantum computing    → IBM, IONQ, RGTI, QUBT
 *  - Biotech/genomics     → CRSP, BEAM, NTLA, EDIT
 *  - Energy tech          → battery, fusion, solar efficiency
 *  - Semiconductor        → ASML, INTC, TSM, KLAC
 *
 * Free public API (Atom/XML), no key required.
 */

const BASE = 'https://export.arxiv.org/api/query';

// Cache results for 4 hours to avoid rate limiting
const _cache = new Map();
const CACHE_TTL = 4 * 60 * 60 * 1000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CATEGORY_SIGNALS = {
  'cs.AI':     { name: 'Artificial Intelligence',   tickers: ['NVDA', 'MSFT', 'GOOG', 'META', 'AMD', 'AMZN'] },
  'cs.LG':     { name: 'Machine Learning',          tickers: ['NVDA', 'AMD', 'MSFT', 'GOOG', 'TSM'] },
  'cs.CR':     { name: 'Cybersecurity',             tickers: ['CRWD', 'PANW', 'ZS', 'S', 'OKTA'] },
  'quant-ph':  { name: 'Quantum Computing',         tickers: ['IBM', 'IONQ', 'RGTI', 'QUBT', 'MSFT'] },
  'q-bio.GN':  { name: 'Genomics',                 tickers: ['CRSP', 'BEAM', 'NTLA', 'EDIT', 'ILMN'] },
  'q-bio.QM':  { name: 'Quantitative Biology',     tickers: ['LLY', 'MRK', 'REGN', 'BIIB', 'AMGN'] },
  'eess.SY':   { name: 'Systems & Control (Robotics)', tickers: ['ABB', 'FANUC', 'ISRG', 'BRKS'] },
  'cond-mat':  { name: 'Condensed Matter (Semiconductors)', tickers: ['ASML', 'KLAC', 'AMAT', 'LRCX', 'INTC', 'TSM'] },
  'physics.app-ph': { name: 'Applied Physics (Energy/Materials)', tickers: ['ENPH', 'FSLR', 'ARRY', 'RUN'] },
};

// Simple XML parser for arXiv Atom feed
function parseAtomEntry(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
}

function parseArxivAtom(xmlText) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xmlText)) !== null) {
    const entry = match[1];
    const categories = [...entry.matchAll(/term="([^"]+)"/g)].map(m => m[1]);

    entries.push({
      id: parseAtomEntry(entry, 'id').split('/abs/').pop(),
      title: parseAtomEntry(entry, 'title').replace(/\s+/g, ' '),
      summary: parseAtomEntry(entry, 'summary').replace(/\s+/g, ' ').slice(0, 400),
      published: parseAtomEntry(entry, 'published').slice(0, 10),
      authors: [...entry.matchAll(/<name>([^<]+)<\/name>/g)].map(m => m[1]).slice(0, 3),
      categories,
      url: `https://arxiv.org/abs/${parseAtomEntry(entry, 'id').split('/abs/').pop()}`,
    });
  }

  return entries;
}

export async function fetchArxivSignals({ categories = ['cs.AI', 'cs.LG', 'quant-ph', 'q-bio.GN'], maxPerCategory = 5 } = {}) {
  const allPapers = [];

  // Sequential with delay to avoid rate limiting; use cache when available
  for (const cat of categories) {
    const cacheKey = `${cat}-${maxPerCategory}`;
    const cached = _cache.get(cacheKey);
    if (cached && Date.now() - cached.ts < CACHE_TTL) {
      allPapers.push(...cached.papers);
      continue;
    }

    await sleep(1500); // 1.5s between requests — arXiv ToS requirement

    const params = new URLSearchParams({
      search_query: `cat:${cat}`,
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: String(maxPerCategory),
    });

    const res = await fetch(`${BASE}?${params}`, {
      headers: { 'Accept': 'application/atom+xml', 'User-Agent': 'obsidian-flow/1.0' },
    });
    if (!res.ok) continue;

    const xml = await res.text();
    if (xml.includes('Rate exceeded')) { allPapers.push(...(cached?.papers ?? [])); continue; }
    const papers = parseArxivAtom(xml);
    const signal = CATEGORY_SIGNALS[cat];

    const enriched = papers.map(p => ({
      ...p,
      primaryCategory: cat,
      categoryName: signal?.name ?? cat,
      watchTickers: signal?.tickers ?? [],
    }));
    _cache.set(cacheKey, { papers: enriched, ts: Date.now() });
    allPapers.push(...enriched);
  }

  allPapers.sort((a, b) => b.published.localeCompare(a.published));

  // Group by category for summary
  const byCategory = allPapers.reduce((acc, p) => {
    acc[p.primaryCategory] = acc[p.primaryCategory] ?? [];
    acc[p.primaryCategory].push(p);
    return acc;
  }, {});

  // Identify potential breakout topics (appeared in multiple papers today)
  const today = new Date().toISOString().slice(0, 10);
  const todayPapers = allPapers.filter(p => p.published === today);

  return {
    source: 'arxiv',
    categoriesQueried: categories,
    totalPapers: allPapers.length,
    publishedToday: todayPapers.length,
    byCategory,
    papers: allPapers,
    fetchedAt: new Date().toISOString(),
  };
}
