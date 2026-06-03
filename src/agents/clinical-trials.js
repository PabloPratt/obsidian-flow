/**
 * ClinicalTrials.gov agent — identifies biotech/pharma catalysts:
 *  - Phase 3 completions    → PDUFA / FDA submission imminent
 *  - Phase 2 → 3 advances   → major inflection for small-cap biotechs
 *  - High-enrollment trials → signals significant investment
 *
 * Free public API, no key required.
 */

const BASE = 'https://clinicaltrials.gov/api/v2/studies';

// Maps common condition areas to pharma/biotech tickers
const CONDITION_TICKER_MAP = {
  'alzheimer':    ['BIIB', 'LLY', 'RHHBY', 'PRAX'],
  'cancer':       ['MRK', 'BMY', 'AZN', 'REGN', 'AGEN'],
  'diabetes':     ['NVO', 'LLY', 'AMGN', 'SANOFI'],
  'obesity':      ['NVO', 'LLY', 'VKTX'],
  'cardiovascular': ['JNJ', 'PFE', 'AMGN', 'MRK'],
  'autoimmune':   ['ABBV', 'JNJ', 'PFE', 'REGN'],
  'hiv':          ['GILD', 'ViiV', 'MRK'],
  'covid':        ['PFE', 'MRNA', 'AZN', 'JNJ'],
  'rare disease': ['ALNY', 'SRPT', 'BMRN', 'RARE'],
};

function matchConditionTickers(condition = '') {
  const lower = condition.toLowerCase();
  for (const [key, tickers] of Object.entries(CONDITION_TICKER_MAP)) {
    if (lower.includes(key)) return tickers;
  }
  return [];
}

export async function fetchClinicalTrials({ phase = 'PHASE3', status = 'COMPLETED', daysBack = 30, limit = 20 } = {}) {
  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);

  const params = new URLSearchParams({
    'filter.advanced': `AREA[Phase]${phase} AND AREA[LastUpdatePostDate]RANGE[${since}, MAX]`,
    'filter.overallStatus': status,
    'fields': 'NCTId,BriefTitle,OverallStatus,Phase,Condition,InterventionName,EnrollmentCount,LastUpdatePostDate,CompletionDate,LeadSponsorName,BriefSummary',
    'sort': 'LastUpdatePostDate:desc',
    'pageSize': String(limit),
    'format': 'json',
  });

  const res = await fetch(`${BASE}?${params}`);
  if (!res.ok) throw new Error(`ClinicalTrials API error: ${res.status}`);

  const data = await res.json();
  const studies = data.studies ?? [];

  const processed = studies.map(s => {
    const proto = s.protocolSection ?? {};
    const id = proto.identificationModule ?? {};
    const status = proto.statusModule ?? {};
    const design = proto.designModule ?? {};
    const desc = proto.descriptionModule ?? {};
    const sponsor = proto.sponsorCollaboratorsModule ?? {};
    const conditions = proto.conditionsModule?.conditions ?? [];
    const interventions = proto.armsInterventionsModule?.interventions?.map(i => i.interventionName) ?? [];

    const watchTickers = conditions.flatMap(matchConditionTickers);

    return {
      nctId: id.nctId,
      title: id.briefTitle,
      sponsor: sponsor.leadSponsor?.leadSponsorName,
      phase: design.phases?.join(', '),
      status: status.overallStatus,
      conditions,
      interventions,
      enrollment: design.enrollmentInfo?.enrollmentCount,
      completionDate: status.completionDateStruct?.completionDate,
      lastUpdate: status.lastUpdatePostDateStruct?.lastUpdatePostDate,
      briefSummary: desc.briefSummary?.slice(0, 300),
      watchTickers: [...new Set(watchTickers)],
      significance: design.enrollmentInfo?.enrollmentCount > 1000 ? 'high' : 'medium',
    };
  });

  const highSignificance = processed.filter(t => t.significance === 'high');

  return {
    source: 'clinicaltrials_gov',
    query: { phase, status, daysBack },
    totalReturned: processed.length,
    highSignificanceCount: highSignificance.length,
    trials: processed,
    fetchedAt: new Date().toISOString(),
  };
}
