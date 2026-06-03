import { config } from '../config.js';

// Vessel type codes per AIS spec
const VESSEL_TYPE_CODES = {
  tanker:    [80, 81, 82, 83, 84, 85, 86, 87, 88, 89],
  container: [70, 71, 72, 73, 74, 75, 76, 77, 78, 79],
  bulk:      [40, 41, 42, 43, 44, 45, 46, 47, 48, 49],
};

// Major port bounding boxes for density analysis
const PORT_REGIONS = {
  'Los Angeles':  { lat: 33.74, lon: -118.27, radiusNm: 30 },
  'Shanghai':     { lat: 31.23, lon: 121.47, radiusNm: 50 },
  'Rotterdam':    { lat: 51.92, lon: 4.48,   radiusNm: 40 },
  'Singapore':    { lat: 1.25,  lon: 103.82, radiusNm: 40 },
  'Houston':      { lat: 29.75, lon: -95.08, radiusNm: 30 },
};

export async function fetchAISData({ portFocus = 'Los Angeles', vesselType = 'all' } = {}) {
  if (!config.ais.apiKey) {
    // Return synthetic summary when no key is configured
    return {
      source: 'ais_marinetraffic',
      configured: false,
      message: 'Set MARINETRAFFIC_API_KEY in .env to enable live AIS data. Free alternatives: aisstream.io (WebSocket), MarineCadastre.gov (historical).',
      portFocus,
      vesselType,
      // Representative mock for schema validation
      summary: {
        port: portFocus,
        anchoredVessels: null,
        inPortVessels: null,
        approachingVessels: null,
        congestionScore: null,
        dominantCargoType: vesselType === 'all' ? 'container' : vesselType,
      },
      signals: [],
      fetchedAt: new Date().toISOString(),
    };
  }

  const port = PORT_REGIONS[portFocus] ?? PORT_REGIONS['Los Angeles'];
  const params = new URLSearchParams({
    v: '8',
    KEY: config.ais.apiKey,
    LAT: String(port.lat),
    LON: String(port.lon),
    R: String(port.radiusNm),
    COLS: 'MMSI,NAME,SHIPTYPE,STATUS,SPEED,LAT,LON,HEADING,DESTINATION',
  });

  const res = await fetch(`${config.ais.baseUrl}/exportvessels/${params}`);
  if (!res.ok) throw new Error(`MarineTraffic API error: ${res.status}`);

  const vessels = await res.json();

  const typeCodes = vesselType !== 'all' ? VESSEL_TYPE_CODES[vesselType] ?? [] : null;
  const filtered = typeCodes ? vessels.filter(v => typeCodes.includes(Number(v.SHIPTYPE))) : vessels;

  const anchored   = filtered.filter(v => v.STATUS === '1').length;
  const underway   = filtered.filter(v => v.STATUS === '0').length;
  const congestionScore = Math.min(1, anchored / Math.max(filtered.length, 1));

  return {
    source: 'ais_marinetraffic',
    configured: true,
    summary: {
      port: portFocus,
      totalVessels: filtered.length,
      anchoredVessels: anchored,
      underwayVessels: underway,
      congestionScore: congestionScore.toFixed(2),
    },
    vessels: filtered.slice(0, 30),
    fetchedAt: new Date().toISOString(),
  };
}
