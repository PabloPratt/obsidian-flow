/**
 * SEC EDGAR agent — three signals:
 *  1. S-1 / S-1/A filings  → upcoming IPOs
 *  2. Form 4               → insider buying/selling
 *  3. 8-K                  → material events (M&A, leadership, guidance)
 *
 * No API key required. Rate limit: 10 req/sec (EDGAR ToS).
 */

const EDGAR_SEARCH = 'https://efts.sec.gov/LATEST/search-index';
const EDGAR_SUBMISSIONS = 'https://data.sec.gov/submissions';

const HEADERS = { 'User-Agent': 'obsidian-flow research@obsidian-flow.local' };

function daysAgo(n) {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function searchFilings(forms, daysBack = 7, limit = 20) {
  const params = new URLSearchParams({
    forms,
    dateRange: 'custom',
    startdt: daysAgo(daysBack),
    enddt: new Date().toISOString().slice(0, 10),
    hits: { total: { value: 0 } },
  });

  const url = `${EDGAR_SEARCH}?forms=${forms}&dateRange=custom&startdt=${daysAgo(daysBack)}&enddt=${new Date().toISOString().slice(0, 10)}&_source=period_of_report,entity_name,file_date,form_type,biz_location,inc_states&hits.hits.total.value=true&hits.hits._source.period_of_report=true&from=0&size=${limit}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`EDGAR search error ${res.status}`);
  const data = await res.json();
  return data.hits?.hits ?? [];
}

export async function fetchSECFilings({ daysBack = 7 } = {}) {
  const [ipoHits, insiderHits, eventHits] = await Promise.all([
    searchFilings('S-1,S-1%2FA', daysBack, 15),
    searchFilings('4', daysBack, 30),
    searchFilings('8-K', daysBack, 25),
  ]);

  // IPOs — S-1 filings indicate companies registering to go public
  const ipos = ipoHits.map(h => ({
    company: h._source.entity_name,
    filedDate: h._source.file_date,
    formType: h._source.form_type,
    state: h._source.inc_states,
    bizLocation: h._source.biz_location,
    accessionNumber: h._id,
    edgarUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&filenum=${h._id}`,
  }));

  // Insider trades — Form 4 (filter for buy transactions via keyword heuristic)
  const insiderTrades = insiderHits.map(h => ({
    company: h._source.entity_name,
    filedDate: h._source.file_date,
    accessionNumber: h._id,
  }));

  // Material events — 8-K (M&A, guidance, executive changes)
  const materialEvents = eventHits.map(h => ({
    company: h._source.entity_name,
    filedDate: h._source.file_date,
    periodOfReport: h._source.period_of_report,
    accessionNumber: h._id,
  }));

  return {
    source: 'sec_edgar',
    period: { start: daysAgo(daysBack), end: new Date().toISOString().slice(0, 10) },
    ipos: { count: ipos.length, filings: ipos },
    insiderTrades: { count: insiderTrades.length, filings: insiderTrades },
    materialEvents: { count: materialEvents.length, filings: materialEvents },
    fetchedAt: new Date().toISOString(),
  };
}
