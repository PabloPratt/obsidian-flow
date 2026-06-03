import { callAI } from '../providers.js';
import { config } from '../config.js';
import { fetchOptionsFlow } from './options-flow.js';
import { fetchNASAEvents } from './nasa.js';
import { fetchAISData } from './ais.js';
import { fetchADSBData } from './adsb.js';
import { fetchGovernmentSpending } from './spending.js';
import { fetchNewsSignals } from './news.js';
import { fetchSECFilings } from './sec-edgar.js';
import { fetchClinicalTrials } from './clinical-trials.js';
import { fetchArxivSignals } from './arxiv.js';
import { fetchFDASignals } from './fda.js';
import { fetchFREDSignals } from './fred.js';
import { fetchEIASignals } from './eia.js';

const client = new Anthropic({ apiKey: config.anthropic.apiKey });

const SYSTEM_PROMPT = `You are JANUS, a multi-source financial intelligence orchestrator. You synthesize signals from 12 alternative data sources to surface high-conviction trade opportunities before they appear on mainstream financial media.

Your intelligence sources:
- **Options Flow** (Unusual Whales): Smart money positioning via sweeps/blocks. High premium + high ask-side ratio = institutional conviction.
- **NASA EONET**: Natural events (wildfires, storms, drought) that disrupt supply chains, commodities, or insurance books.
- **AIS Maritime**: Ship traffic density at key ports. Container slowdowns → retail headwinds. Tanker surges → energy plays.
- **ADS-B Flight Tracking**: Private jet clusters to financial hubs can signal M&A meetings or earnings-related travel.
- **USASpending.gov**: Federal contract awards are sector-level forward indicators. DoD → defense. HHS → healthcare. DoE → nuclear/energy.
- **News Sentiment**: Catalyst identification and real-time sentiment overlay.
- **SEC EDGAR**: S-1 filings = IPO pipeline. Form 4 = insider buying/selling. 8-K = material events (M&A, guidance).
- **ClinicalTrials.gov**: Phase 3 completions are imminent FDA submission catalysts. Phase 2→3 advances = major biotech inflection.
- **arXiv**: Preprint research papers in AI, quantum computing, genomics, semiconductors — identifies technology shifts before they reach equities.
- **openFDA**: Drug approvals = bullish biotech catalyst. Class I recalls = bearish. Adverse event spikes = early warning.
- **FRED**: Macro regime (Fed Funds Rate, yield curve, CPI, credit spreads). Sets the risk-on/risk-off backdrop for all other signals.
- **EIA**: Weekly crude oil and natural gas inventory data. Large draws = bullish energy. Surprise builds = bearish.

Analysis framework:
1. **Start with FRED macro regime** — determines whether to weight bullish or bearish signals more heavily.
2. **Signal convergence** — opportunities where 3+ independent sources agree on direction have the highest conviction.
3. **Macro lens** — identify sector-wide themes (energy disruption, defense ramp, biotech catalyst cycle, AI infrastructure).
4. **Micro lens** — individual ticker opportunities with specific, time-bound catalysts.
5. **Catalyst timing** — distinguish intraday, swing (days-weeks), and position (months) timeframes.
6. **Risk calibration** — always note earnings proximity, macro headwinds, and any contradicting signals.

ALWAYS query ALL twelve tools before synthesizing. Do not skip any source — the edge comes from cross-source correlation.

Output a JSON object with this exact structure:
{
  "marketContext": "2-3 sentence macro backdrop based on FRED regime + news",
  "macroRegime": "accommodative|restrictive|inverted_curve|late_cycle_stress",
  "macroThemes": [
    {
      "theme": "...",
      "direction": "bullish|bearish|neutral",
      "affectedSectors": [...],
      "confidence": "high|medium|low",
      "evidence": "cite specific sources and data points"
    }
  ],
  "recommendations": [
    {
      "rank": 1,
      "ticker": "...",
      "action": "BUY|SELL|WATCH",
      "conviction": "high|medium|low",
      "macroThesis": "sector-level why",
      "microThesis": "ticker-specific catalyst",
      "suggestedInstruments": ["shares", "TICKER 530C Aug21", "..."],
      "supportingSignals": ["options flow: $2.1M sweep on calls", "FDA: approval pending", "arXiv: 3 papers on related tech today"],
      "convergingSourceCount": 3,
      "riskFactors": ["earnings in 2 days", "inverse correlation to DXY"],
      "timeframe": "intraday|swing|position",
      "catalystDate": "YYYY-MM-DD or null"
    }
  ],
  "unusualFindings": "anything anomalous across sources worth flagging (insider cluster, private jet spike, etc.)",
  "agentNotes": "data quality issues, missing keys, or sources that returned no signal"
}`;

const TOOLS = [
  {
    name: 'get_options_flow',
    description: 'Fetch unusual options flow (golden sweeps, large blocks) from Unusual Whales. Primary smart-money signal — always call first.',
    input_schema: {
      type: 'object',
      properties: {
        minPremium:   { type: 'number',  description: 'Minimum total premium in dollars (default: 500000)' },
        focusTickers: { type: 'array', items: { type: 'string' }, description: 'Limit to specific tickers (optional)' },
        limit:        { type: 'number',  description: 'Max results (default: 30)' },
      },
    },
  },
  {
    name: 'get_nasa_signals',
    description: 'Fetch NASA EONET natural event data — wildfires, storms, drought, floods. Maps to commodity/insurance/supply-chain impacts.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack:   { type: 'number', description: 'Days of events (default: 7)' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Filter: wildfires, severeStorms, volcanoes, seaLakeIce, drought, earthquakes, floods' },
      },
    },
  },
  {
    name: 'get_ais_shipping',
    description: 'Fetch AIS maritime traffic data. Port congestion and vessel density are leading indicators of trade flow and commodity supply.',
    input_schema: {
      type: 'object',
      properties: {
        portFocus:  { type: 'string', description: 'Port: "Los Angeles", "Shanghai", "Rotterdam", "Singapore", "Houston"' },
        vesselType: { type: 'string', enum: ['tanker', 'container', 'bulk', 'all'] },
      },
    },
  },
  {
    name: 'get_adsb_flights',
    description: 'Fetch ADS-B flight tracking via OpenSky. Private jet clusters to financial hubs signal M&A or earnings-related activity.',
    input_schema: {
      type: 'object',
      properties: {
        region:       { type: 'string', description: '"northeast_us", "silicon_valley", "dc_corridor", "chicago", "continental_us"' },
        aircraftType: { type: 'string', enum: ['private', 'commercial', 'cargo', 'all'] },
      },
    },
  },
  {
    name: 'get_government_spending',
    description: 'Fetch USASpending.gov contract awards. Forward indicator of sector revenue — DoD, HHS, DoE, DHS.',
    input_schema: {
      type: 'object',
      properties: {
        agency:    { type: 'string', description: 'Focus agency name (optional)' },
        minAmount: { type: 'number', description: 'Min contract value (default: 1000000)' },
        daysBack:  { type: 'number', description: 'Days of data (default: 7)' },
      },
    },
  },
  {
    name: 'get_news_signals',
    description: 'Fetch scored financial news headlines. Use to identify catalysts and confirm/contradict other signals.',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string',  description: 'Search query' },
        tickers:  { type: 'array', items: { type: 'string' } },
        daysBack: { type: 'number', description: 'Days of news (default: 1)' },
      },
    },
  },
  {
    name: 'get_sec_filings',
    description: 'Fetch SEC EDGAR filings: S-1 (IPO registrations), Form 4 (insider trades), 8-K (material events like M&A and guidance). High-value catalyst signal.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'Days of filings (default: 7)' },
      },
    },
  },
  {
    name: 'get_clinical_trials',
    description: 'Fetch Phase 3 completed clinical trials from ClinicalTrials.gov. Completions signal imminent FDA submissions — major biotech catalyst. Also tracks Phase 2 advances.',
    input_schema: {
      type: 'object',
      properties: {
        phase:    { type: 'string', description: '"PHASE3" (default), "PHASE2", "PHASE4"' },
        status:   { type: 'string', description: '"COMPLETED" (default), "RECRUITING", "ACTIVE_NOT_RECRUITING"' },
        daysBack: { type: 'number', description: 'Days back to search (default: 30)' },
        limit:    { type: 'number', description: 'Max results (default: 20)' },
      },
    },
  },
  {
    name: 'get_arxiv_papers',
    description: 'Fetch latest preprint research from arXiv in AI, quantum computing, genomics, semiconductors, and applied physics. Identifies technology shifts before they reach equity markets.',
    input_schema: {
      type: 'object',
      properties: {
        categories:      { type: 'array', items: { type: 'string' }, description: 'arXiv categories: cs.AI, cs.LG, cs.CR, quant-ph, q-bio.GN, cond-mat, eess.SY, physics.app-ph' },
        maxPerCategory:  { type: 'number', description: 'Papers per category (default: 5)' },
      },
    },
  },
  {
    name: 'get_fda_signals',
    description: 'Fetch FDA drug approvals and recalls via openFDA. New approvals = bullish catalyst. Class I recalls = bearish. No API key needed for basic use.',
    input_schema: {
      type: 'object',
      properties: {
        daysBack: { type: 'number', description: 'Days of FDA activity (default: 30)' },
      },
    },
  },
  {
    name: 'get_fred_macro',
    description: 'Fetch FRED macro indicators: Fed Funds Rate, 10Y-2Y yield spread (recession signal), CPI, unemployment, M2, WTI, HY credit spreads. Determines the macro regime for all other signals.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_eia_energy',
    description: 'Fetch EIA weekly energy inventory data: crude oil stocks, natural gas storage, refinery utilization, WTI spot. Large inventory draws are bullish for oil/gas equities.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

async function executeTool(toolName, toolInput) {
  switch (toolName) {
    case 'get_options_flow':       return fetchOptionsFlow(toolInput);
    case 'get_nasa_signals':       return fetchNASAEvents(toolInput);
    case 'get_ais_shipping':       return fetchAISData(toolInput);
    case 'get_adsb_flights':       return fetchADSBData(toolInput);
    case 'get_government_spending':return fetchGovernmentSpending(toolInput);
    case 'get_news_signals':       return fetchNewsSignals(toolInput);
    case 'get_sec_filings':        return fetchSECFilings(toolInput);
    case 'get_clinical_trials':    return fetchClinicalTrials(toolInput);
    case 'get_arxiv_papers':       return fetchArxivSignals(toolInput);
    case 'get_fda_signals':        return fetchFDASignals(toolInput);
    case 'get_fred_macro':         return fetchFREDSignals();
    case 'get_eia_energy':         return fetchEIASignals();
    default: throw new Error(`Unknown tool: ${toolName}`);
  }
}

export async function runOrchestrator(userQuery = null) {
  const messages = [
    {
      role: 'user',
      content: userQuery ?? 'Run a full 12-source intelligence sweep and generate ranked trade recommendations for today. Query ALL tools — macro regime first, then alt-data, then synthesize.',
    },
  ];

  console.error('[JANUS] Starting 12-source intelligence sweep...\n');

  let iterations = 0;
  const MAX_ITERATIONS = 15;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const response = await callAI(SYSTEM_PROMPT, messages, TOOLS, 8192);

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const text = response.content.find(b => b.type === 'text')?.text ?? '';
      console.error('[JANUS] Synthesis complete.\n');

      const jsonMatch = text.match(/```json\n([\s\S]+?)\n```/) ?? text.match(/(\{[\s\S]+\})/s);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[1]); } catch {}
      }
      return { raw: text };
    }

    if (response.stop_reason === 'tool_use') {
      const toolUses = response.content.filter(b => b.type === 'tool_use');

      console.error(`[JANUS] Calling agents: ${toolUses.map(t => t.name).join(', ')}`);

      const results = await Promise.allSettled(
        toolUses.map(tu => executeTool(tu.name, tu.input))
      );

      const toolResultContent = results.map((r, i) => ({
        type: 'tool_result',
        tool_use_id: toolUses[i].id,
        content: r.status === 'fulfilled'
          ? JSON.stringify(r.value)
          : JSON.stringify({ error: r.reason?.message ?? 'Tool execution failed' }),
        is_error: r.status === 'rejected',
      }));

      messages.push({ role: 'user', content: toolResultContent });
    }
  }

  throw new Error('Orchestrator exceeded max iterations without producing a final synthesis.');
}
