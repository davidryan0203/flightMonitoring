// ── Configuration ────────────────────────────────────────────────────────────
const TIMEZONE        = 'America/Goose_Bay';
const ALLOWED_OPERATORS = new Set(['PVL', 'PB', 'ACA', 'AC']);
const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']);
const EXCLUDED_ORIGIN = 'CVB2';

// ── Live API (uncomment when quota resets) ────────────────────────────────────
// const API_KEY = 'cUMXuU3rMbSQfiAGVIMa4qMHbJGXN9Z7';
// const AERO_API_URL = '/aeroapi'; // Proxied via Vite → https://aeroapi.flightaware.com/aeroapi
// const HOME_AIRPORT_CODE = 'CYYR';
// const fetchWithKey = (url) =>
//   fetch(url, { headers: { 'x-apikey': API_KEY } }).then(r => r.json());

// ── Helpers (mirrors server.js logic) ────────────────────────────────────────
function formatDatetime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('en-CA', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  } catch { return ''; }
}

function deriveStatus(scheduledIso, estimatedIso) {
  if (!scheduledIso || !estimatedIso) return 'Scheduled';
  const diff = (new Date(estimatedIso) - new Date(scheduledIso)) / 60000;
  if (diff > 1)  return 'Delayed';
  if (diff < -1) return 'Early';
  return 'On Time';
}

function toLocalMinutesOfDay(isoString) {
  if (!isoString) return null;

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: TIMEZONE,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(new Date(isoString));

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const rawHour = Number(map.hour);
    const rawMinute = Number(map.minute);
    const dayPeriod = (map.dayPeriod || '').toLowerCase();

    if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) {
      return null;
    }

    let hour24 = rawHour % 12;
    if (dayPeriod.includes('p')) {
      hour24 += 12;
    }

    return hour24 * 60 + rawMinute;
  } catch {
    return null;
  }
}

function normalizeStatus(status = '') {
  return status.trim().toLowerCase();
}

function computeDisplayStatus(type, rawStatus, scheduledIso, estimatedIso) {
  void type;

  const normalizedStatus = normalizeStatus(rawStatus);

  if (normalizedStatus.includes('delayed')) {
    return 'Delayed';
  }

  const scheduledMins = toLocalMinutesOfDay(scheduledIso);
  const estimatedMins = toLocalMinutesOfDay(estimatedIso);

  if (scheduledMins !== null && estimatedMins !== null) {
    if (scheduledMins < estimatedMins) return 'Delayed';
    if (scheduledMins > estimatedMins) return 'Early';
    return 'On Time';
  }

  const derivedStatus = deriveStatus(scheduledIso, estimatedIso);
  const normalizedDerived = normalizeStatus(derivedStatus);
  if (normalizedDerived === 'delayed') {
    return 'Delayed';
  }

  return rawStatus || derivedStatus;
}

function stripRawTime(flight) {
  return {
    flight: flight.flight,
    airline: flight.airline,
    from: flight.from,
    fromCode: flight.fromCode,
    expected: flight.expected,
    actual: flight.actual,
    status: flight.status,
    to: flight.to,
    toCode: flight.toCode,
    schedule: flight.schedule,
    isTomorrow: flight.isTomorrow,
    rawTime: flight.rawTime,
  };
}

function getDateParts(dateInput) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(dateInput));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(map.year), month: Number(map.month), day: Number(map.day) };
}

function formatDateKey(parts) {
  return [parts.year, String(parts.month).padStart(2, '0'), String(parts.day).padStart(2, '0')].join('-');
}

function isTomorrowFlight(isoString) {
  if (!isoString) return false;
  try {
    const flightDateKey = formatDateKey(getDateParts(isoString));
    const todayParts = getDateParts(Date.now());
    const tomorrowUtc = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + 1));
    const tomorrowKey = `${tomorrowUtc.getUTCFullYear()}-${String(tomorrowUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowUtc.getUTCDate()).padStart(2, '0')}`;
    return flightDateKey === tomorrowKey;
  } catch { return false; }
}

function resolveAirline(city) {
  if (city === 'Halifax') return 'Air Canada';
  if (AIR_BOREALIS_CITIES.has(city)) return 'Air Borealis';
  return 'PAL Airlines';
}

function isAllowedOperator(f) {
  return (
    ALLOWED_OPERATORS.has(f.operator       ?? '') ||
    ALLOWED_OPERATORS.has(f.operator_icao  ?? '') ||
    ALLOWED_OPERATORS.has(f.operator_iata  ?? '')
  );
}

// ── Helper: Process flights from a data source ────────────────────────────────
function processArrivals(rawArrivals = []) {
  const arrivals = [];
  for (const f of rawArrivals) {
    if (!isAllowedOperator(f)) continue;
    const originCode = f.origin?.code ?? '';
    if (originCode === EXCLUDED_ORIGIN) continue;
    const originCity  = f.origin?.city ?? originCode ?? '–';
    // Prefer explicit `expected`/`actual` provided by the server (Intelisys mapping).
    const expectedIso = f.expected ?? f.estimated_on ?? f.estimated_in ?? null;
    const scheduledOn = f.actual ?? f.scheduled_on ?? f.scheduled_in ?? null;
    let displayStatus = computeDisplayStatus('arrivals', f.status, scheduledOn, expectedIso);
    // If Intelisys provides a flightLegStatus or cancelled flag, respect it
    if (Boolean(f.cancelled) || Boolean(f.flightLegStatus?.cancelled)) {
      displayStatus = 'Cancelled';
    }
    const primaryArrivalTime = scheduledOn ?? expectedIso ?? null;
    arrivals.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(originCity),
      from:      originCity,
      fromCode:  originCode,
      // Map UI: Expected = estimatedTime, Actual = scheduledTime
      expected:  formatDatetime(expectedIso),
      actual:    formatDatetime(scheduledOn),
      status:    displayStatus,
      isTomorrow: isTomorrowFlight(primaryArrivalTime),
      rawTime:   scheduledOn ?? expectedIso ?? '',
      source:    f.source ?? 'unknown',
    });
  }
  return arrivals;
}

function processDepartures(rawDepartures = []) {
  const departures = [];
  for (const f of rawDepartures) {
    if (!isAllowedOperator(f)) continue;
    const destCity   = f.destination?.city ?? f.destination?.code ?? '–';
    const destCode   = f.destination?.code ?? '';
    // Prefer explicit `expected`/`actual` fields when available on server-mapped objects
    const expectedOff = f.expected ?? f.estimated_off ?? f.estimated_out ?? null;
    const scheduledOff = f.actual ?? f.scheduled_off ?? f.scheduled_out ?? null;
    let displayStatus = computeDisplayStatus('departures', f.status, scheduledOff, expectedOff);
    // If Intelisys provides a flightLegStatus or cancelled flag, respect it
    if (Boolean(f.cancelled) || Boolean(f.flightLegStatus?.cancelled)) {
      displayStatus = 'Cancelled';
    }
    const primaryDepartureTime = scheduledOff ?? expectedOff ?? null;
    departures.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(destCity),
      to:        destCity,
      toCode:    destCode,
      // Map UI: Expected (schedule column) = estimatedTime, Actual = scheduledTime
      schedule:  formatDatetime(expectedOff),
      actual:    formatDatetime(scheduledOff),
      status:    displayStatus,
      isTomorrow: isTomorrowFlight(primaryDepartureTime),
      rawTime:   scheduledOff ?? expectedOff ?? '',
      source:    f.source ?? 'unknown',
    });
  }
  return departures;
}

// ── Deduplication helper: Remove duplicate flights ────────────────────────────
function deduplicateFlights(flights) {
  const seen = new Map();
  const unique = [];
  for (const flight of flights) {
    const key = `${flight.flight}|${flight.rawTime}`;
    if (!seen.has(key)) {
      seen.set(key, true);
      unique.push(flight);
    }
  }
  return unique;
}

// ── Main fetch ────────────────────────────────────────────────────────────────
export const fetchFlightData = async () => {
  // ── Live API (uncomment when quota resets) ──────────────────────────────
  // const [arrivalsData, departuresData] = await Promise.all([
  //   fetchWithKey(`${AERO_API_URL}/airports/${HOME_AIRPORT_CODE}/flights/scheduled_arrivals`),
  //   fetchWithKey(`${AERO_API_URL}/airports/${HOME_AIRPORT_CODE}/flights/scheduled_departures`),
  // ]);
  // const rawArrivals   = arrivalsData.scheduled_arrivals   ?? arrivalsData.flights   ?? [];
  // const rawDepartures = departuresData.scheduled_departures ?? departuresData.flights ?? [];

  // ── Local JSON (served from public/) ───────────────────────────────────
  // Fetch both Intelisys and FlightAware data sources
  const [intelisysArrivalsRes, intelisysDeparturesRes, flightawareArrivalsRes, flightawareDeparturesRes] = await Promise.all([
    fetch('/arrivals.json').catch(() => null),
    fetch('/departures.json').catch(() => null),
    fetch('/flightaware_arrivals.json').catch(() => null),
    fetch('/flightaware_departures.json').catch(() => null),
  ]);

  let intelisysArrivals = [];
  let intelisysDepartures = [];
  let flightawareArrivals = [];
  let flightawareDepartures = [];

  if (intelisysArrivalsRes?.ok) {
    const data = await intelisysArrivalsRes.json();
    intelisysArrivals = data.scheduled_arrivals ?? data.flights ?? [];
  }

  if (intelisysDeparturesRes?.ok) {
    const data = await intelisysDeparturesRes.json();
    intelisysDepartures = data.scheduled_departures ?? data.flights ?? [];
  }

  if (flightawareArrivalsRes?.ok) {
    const data = await flightawareArrivalsRes.json();
    flightawareArrivals = data.scheduled_arrivals ?? data.flights ?? [];
  }

  if (flightawareDeparturesRes?.ok) {
    const data = await flightawareDeparturesRes.json();
    flightawareDepartures = data.scheduled_departures ?? data.flights ?? [];
  }

  if (intelisysArrivals.length === 0 && intelisysDepartures.length === 0 && flightawareArrivals.length === 0 && flightawareDepartures.length === 0) {
    throw new Error('Failed to load flight data from any source.');
  }

  // ── Merge and process Arrivals ─────────────────────────────────────────────
  const allArrivals = [
    ...processArrivals(intelisysArrivals),
    ...processArrivals(flightawareArrivals),
  ];
  const arrivals = deduplicateFlights(allArrivals);
  arrivals.sort((a, b) => a.rawTime.localeCompare(b.rawTime));

  // ── Merge and process Departures ───────────────────────────────────────────
  const allDepartures = [
    ...processDepartures(intelisysDepartures),
    ...processDepartures(flightawareDepartures),
  ];
  const departures = deduplicateFlights(allDepartures);
  departures.sort((a, b) => a.rawTime.localeCompare(b.rawTime));

  console.log(`Loaded ${arrivals.length} arrivals (Intelisys: ${intelisysArrivals.length}, FlightAware: ${flightawareArrivals.length})`);
  console.log(`Loaded ${departures.length} departures (Intelisys: ${intelisysDepartures.length}, FlightAware: ${flightawareDepartures.length})`);
  return {
    arrivals:   arrivals.map(stripRawTime),
    departures: departures.map(stripRawTime),
  };
};

