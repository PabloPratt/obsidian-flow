import { config } from '../config.js';

// Bounding boxes for key financial/corporate hubs
const REGIONS = {
  northeast_us:    { lamin: 38.5, lomin: -80.0, lamax: 45.5, lomax: -70.0 },
  silicon_valley:  { lamin: 37.0, lomin: -122.5, lamax: 38.0, lomax: -121.5 },
  dc_corridor:     { lamin: 38.0, lomin: -78.0, lamax: 40.0, lomax: -76.0 },
  chicago:         { lamin: 41.0, lomin: -88.5, lamax: 42.5, lomax: -87.0 },
  continental_us:  { lamin: 24.5, lomin: -125.0, lamax: 49.5, lomax: -66.9 },
};

// ICAO aircraft type prefixes associated with private/executive jets
const PRIVATE_JET_PREFIXES = ['GLF', 'CL60', 'C56X', 'F900', 'FA7X', 'BE40', 'C68A', 'E50P', 'PC12'];

export async function fetchADSBData({ region = 'continental_us', aircraftType = 'private' } = {}) {
  const bbox = REGIONS[region] ?? REGIONS.continental_us;
  const params = new URLSearchParams(bbox);

  const headers = {};
  if (config.opensky.username) {
    const creds = Buffer.from(`${config.opensky.username}:${config.opensky.password}`).toString('base64');
    headers.Authorization = `Basic ${creds}`;
  }

  const res = await fetch(`${config.opensky.baseUrl}/states/all?${params}`, { headers });
  if (!res.ok) throw new Error(`OpenSky API error: ${res.status}`);

  const data = await res.json();
  const states = data.states ?? [];

  // OpenSky state vector fields:
  // [icao24, callsign, origin_country, time_position, last_contact,
  //  longitude, latitude, baro_altitude, on_ground, velocity,
  //  true_track, vertical_rate, sensors, geo_altitude, squawk, spi, position_source]
  let flights = states
    .filter(s => s[8] === false) // airborne only
    .map(s => ({
      icao24: s[0],
      callsign: s[1]?.trim(),
      originCountry: s[2],
      longitude: s[5],
      latitude: s[6],
      altitudeFt: s[7] ? Math.round(s[7] * 3.281) : null,
      velocityKnots: s[9] ? Math.round(s[9] * 1.944) : null,
      heading: s[10],
      verticalRateFpm: s[11] ? Math.round(s[11] * 196.85) : null,
      onGround: s[8],
    }));

  if (aircraftType === 'private') {
    flights = flights.filter(f =>
      f.callsign && PRIVATE_JET_PREFIXES.some(p => f.callsign.startsWith(p))
    );
  }

  const summary = {
    region,
    aircraftType,
    totalAirborne: states.filter(s => !s[8]).length,
    filteredCount: flights.length,
    averageAltitudeFt: flights.length
      ? Math.round(flights.reduce((sum, f) => sum + (f.altitudeFt ?? 0), 0) / flights.length)
      : null,
  };

  return {
    source: 'opensky_adsb',
    summary,
    flights: flights.slice(0, 50), // cap payload
    fetchedAt: new Date().toISOString(),
  };
}
