import { config } from '../config.js';

// Maps EONET category IDs to market impact areas
const CATEGORY_MARKET_MAP = {
  wildfires:      { sectors: ['Utilities', 'Insurance', 'Timber'], tickers: ['AIZ', 'CB', 'PCH'] },
  severeStorms:   { sectors: ['Insurance', 'Homebuilders', 'Retail'], tickers: ['AIZ', 'PHM', 'HD'] },
  volcanoes:      { sectors: ['Airlines', 'Tourism', 'Agriculture'], tickers: ['DAL', 'MAR', 'MOS'] },
  seaLakeIce:     { sectors: ['Shipping', 'Energy', 'Fishing'], tickers: ['ZIM', 'XOM', 'SFD'] },
  drought:        { sectors: ['Agriculture', 'Water', 'Food'], tickers: ['MOS', 'DE', 'CAG'] },
  earthquakes:    { sectors: ['Insurance', 'Construction', 'Utilities'], tickers: ['CB', 'VMC', 'PCG'] },
  floods:         { sectors: ['Insurance', 'Agriculture', 'Infrastructure'], tickers: ['AIZ', 'ADM', 'PLOW'] },
};

export async function fetchNASAEvents({ daysBack = 7, categories = [] } = {}) {
  const params = new URLSearchParams({ days: String(daysBack), status: 'open', limit: '50' });
  if (categories.length) params.set('categories', categories.join(','));

  const res = await fetch(`${config.nasa.eonetUrl}/events?${params}`);
  if (!res.ok) throw new Error(`NASA EONET error: ${res.status}`);

  const { events } = await res.json();

  const signals = events.map(event => {
    const categorySlug = event.categories?.[0]?.id ?? 'unknown';
    const marketImpact = CATEGORY_MARKET_MAP[categorySlug] ?? { sectors: [], tickers: [] };

    const geometries = event.geometry ?? [];
    const latestGeom = geometries.at(-1);

    return {
      id: event.id,
      title: event.title,
      category: categorySlug,
      status: event.closed ? 'closed' : 'ongoing',
      startDate: event.geometry?.[0]?.date,
      coordinates: latestGeom?.coordinates ?? null,
      magnitude: latestGeom?.magnitudeValue ?? null,
      magnitudeUnit: latestGeom?.magnitudeUnit ?? null,
      affectedSectors: marketImpact.sectors,
      watchTickers: marketImpact.tickers,
      sourceUrl: event.sources?.[0]?.url ?? null,
    };
  });

  // Group by category for summary
  const byCategory = signals.reduce((acc, s) => {
    acc[s.category] = (acc[s.category] ?? []);
    acc[s.category].push(s);
    return acc;
  }, {});

  return {
    source: 'nasa_eonet',
    totalEvents: signals.length,
    byCategory,
    signals,
    fetchedAt: new Date().toISOString(),
  };
}
