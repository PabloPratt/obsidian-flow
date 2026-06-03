/**
 * openFDA agent — drug approval and recall signals:
 *  - New drug approvals (NDA/BLA)  → massive biotech catalysts
 *  - Drug recalls                  → bearish for manufacturers
 *  - Adverse event spikes          → early warning for drugs under pressure
 *
 * Free public API. No key required for up to 1000 req/day.
 * With free API key: 120,000 req/day.
 */

import { config } from '../config.js';

const BASE = 'https://api.fda.gov';

const KEY_SUFFIX = config.fda?.apiKey ? `&api_key=${config.fda.apiKey}` : '';

// Known drug→ticker mapping for major approvals
const DRUG_TICKER_MAP = {
  'pfizer':    'PFE',
  'merck':     'MRK',
  'abbvie':    'ABBV',
  'lilly':     'LLY',
  'novartis':  'NVS',
  'johnson':   'JNJ',
  'roche':     'RHHBY',
  'amgen':     'AMGN',
  'gilead':    'GILD',
  'biogen':    'BIIB',
  'regeneron': 'REGN',
  'moderna':   'MRNA',
  'bristol':   'BMY',
  'astrazeneca': 'AZN',
  'novo nordisk': 'NVO',
};

function mapSponsorToTicker(sponsorName = '') {
  const lower = sponsorName.toLowerCase();
  for (const [key, ticker] of Object.entries(DRUG_TICKER_MAP)) {
    if (lower.includes(key)) return ticker;
  }
  return null;
}

export async function fetchFDASignals({ daysBack = 30 } = {}) {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');

  const [approvalsRes, recallsRes] = await Promise.all([
    fetch(`${BASE}/drug/drugsfda.json?search=submissions.submission_status_date:[${since}+TO+99999999]+AND+submissions.submission_status:"AP"&limit=20&sort=submissions.submission_status_date:desc${KEY_SUFFIX}`),
    fetch(`${BASE}/drug/enforcement.json?search=report_date:[${since}+TO+99999999]&limit=15&sort=report_date:desc${KEY_SUFFIX}`),
  ]);

  // Approvals
  let approvals = [];
  if (approvalsRes.ok) {
    const data = await approvalsRes.json();
    approvals = (data.results ?? []).map(r => {
      const latestSub = r.submissions?.find(s => s.submission_status === 'AP') ?? {};
      const ticker = mapSponsorToTicker(r.sponsor_name);

      return {
        applicationNumber: r.application_number,
        sponsorName: r.sponsor_name,
        brandName: r.products?.[0]?.brand_name,
        genericName: r.products?.[0]?.active_ingredients?.map(i => i.name).join(', '),
        approvalDate: latestSub.submission_status_date,
        submissionType: latestSub.submission_type,
        reviewPriority: latestSub.review_priority,
        ticker,
        signal: 'bullish',
      };
    }).filter(a => a.approvalDate >= since);
  }

  // Recalls
  let recalls = [];
  if (recallsRes.ok) {
    const data = await recallsRes.json();
    recalls = (data.results ?? []).map(r => {
      const ticker = mapSponsorToTicker(r.recalling_firm ?? '');
      return {
        recallingFirm: r.recalling_firm,
        productDescription: r.product_description?.slice(0, 150),
        reasonForRecall: r.reason_for_recall?.slice(0, 200),
        classification: r.classification, // Class I = most serious
        reportDate: r.report_date,
        country: r.country,
        ticker,
        signal: 'bearish',
        severity: r.classification === 'Class I' ? 'high' : r.classification === 'Class II' ? 'medium' : 'low',
      };
    });
  }

  return {
    source: 'openfda',
    period: { daysBack },
    approvals: { count: approvals.length, items: approvals },
    recalls: { count: recalls.length, items: recalls },
    fetchedAt: new Date().toISOString(),
  };
}
