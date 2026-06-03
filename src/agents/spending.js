import { config } from '../config.js';

// Maps awarding agencies to investable sectors/tickers
const AGENCY_SECTOR_MAP = {
  'Department of Defense':                   { sectors: ['Defense', 'Aerospace'], tickers: ['LMT', 'RTX', 'NOC', 'GD', 'BA'] },
  'Department of Health and Human Services': { sectors: ['Healthcare', 'Pharma'], tickers: ['UNH', 'CVS', 'MCK', 'ABC'] },
  'Department of Energy':                    { sectors: ['Energy', 'Nuclear', 'Utilities'], tickers: ['CCJ', 'NEE', 'VST', 'ETR'] },
  'Department of Transportation':            { sectors: ['Infrastructure', 'Construction'], tickers: ['CAT', 'VMC', 'MLM', 'URI'] },
  'National Aeronautics and Space Administration': { sectors: ['Aerospace', 'Space'], tickers: ['BA', 'LMT', 'RKLB', 'ASTS'] },
  'Department of Homeland Security':         { sectors: ['Cyber', 'Defense'], tickers: ['CRWD', 'PANW', 'AXON', 'S'] },
  'Department of Veterans Affairs':          { sectors: ['Healthcare', 'IT'], tickers: ['UNH', 'HUM', 'LDOS'] },
};

function getDateRange(daysBack) {
  const end = new Date();
  const start = new Date(Date.now() - daysBack * 86_400_000);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export async function fetchGovernmentSpending({ agency = null, minAmount = 1_000_000, daysBack = 7 } = {}) {
  const { start, end } = getDateRange(daysBack);

  const body = {
    filters: {
      time_period: [{ start_date: start, end_date: end }],
      award_amounts: [{ lower_bound: minAmount }],
      award_type_codes: ['A', 'B', 'C', 'D'], // contracts only
      ...(agency ? { agencies: [{ type: 'awarding', tier: 'toptier', name: agency }] } : {}),
    },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Description', 'Start Date', 'Award Type'],
    limit: 25,
    sort: 'Award Amount',
    order: 'desc',
    subawards: false,
  };

  const res = await fetch('https://api.usaspending.gov/api/v2/search/spending_by_award/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`USASpending API error: ${res.status}`);
  const { results, page_metadata } = await res.json();

  const contracts = results.map(r => {
    const awardingAgency = r['Awarding Agency'] ?? '';
    const marketImpact = Object.entries(AGENCY_SECTOR_MAP).find(([key]) =>
      awardingAgency.includes(key.split(' ').slice(1, 3).join(' '))
    )?.[1] ?? { sectors: [], tickers: [] };

    return {
      awardId: r['Award ID'],
      recipient: r['Recipient Name'],
      amount: r['Award Amount'],
      agency: awardingAgency,
      subAgency: r['Awarding Sub Agency'],
      description: r['Description'],
      startDate: r['Start Date'],
      awardType: r['Award Type'],
      affectedSectors: marketImpact.sectors,
      watchTickers: marketImpact.tickers,
    };
  });

  // Aggregate spend by agency
  const agencyTotals = contracts.reduce((acc, c) => {
    acc[c.agency] = (acc[c.agency] ?? 0) + c.amount;
    return acc;
  }, {});

  const topAgency = Object.entries(agencyTotals).sort(([, a], [, b]) => b - a)[0];

  return {
    source: 'usa_spending',
    period: { start, end },
    totalContracts: page_metadata?.total ?? contracts.length,
    totalValue: contracts.reduce((s, c) => s + c.amount, 0),
    topAgency: topAgency ? { name: topAgency[0], total: topAgency[1] } : null,
    contracts,
    fetchedAt: new Date().toISOString(),
  };
}
