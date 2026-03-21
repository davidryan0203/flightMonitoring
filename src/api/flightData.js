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
  const [arrivalsRes, departuresRes] = await Promise.all([
    fetch('/arrivals.json'),
    fetch('/departures.json'),
  ]);
  if (!arrivalsRes.ok || !departuresRes.ok) {
    throw new Error('Failed to load local flight JSON files.');
  }
  const [arrivalsData, departuresData] = await Promise.all([
    arrivalsRes.json(),
    departuresRes.json(),
  ]);
  const rawArrivals   = arrivalsData.scheduled_arrivals     ?? arrivalsData.flights   ?? [];
  const rawDepartures = departuresData.scheduled_departures ?? departuresData.flights  ?? [];

  // ── Process Arrivals ──────────────────────────────────────────────────────
  const arrivals = [];
  for (const f of rawArrivals) {
    if (!isAllowedOperator(f)) continue;
    const originCode = f.origin?.code ?? '';
    if (originCode === EXCLUDED_ORIGIN) continue;
    const originCity  = f.origin?.city ?? originCode ?? '–';
    const scheduledOn = f.scheduled_on ?? null;
    const estimatedOn = f.estimated_on ?? null;
    const displayStatus = computeDisplayStatus('arrivals', f.status, scheduledOn, estimatedOn);
    const primaryArrivalTime = scheduledOn ?? estimatedOn ?? null;
    arrivals.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(originCity),
      from:      originCity,
      fromCode:  originCode,
      expected:  formatDatetime(scheduledOn),
      actual:    formatDatetime(estimatedOn),
      status:    displayStatus,
      isTomorrow: isTomorrowFlight(primaryArrivalTime),
      rawTime:   scheduledOn ?? estimatedOn ?? '',
    });
  }
  arrivals.sort((a, b) => a.rawTime.localeCompare(b.rawTime));

  // ── Process Departures ────────────────────────────────────────────────────
  const departures = [];
  for (const f of rawDepartures) {
    if (!isAllowedOperator(f)) continue;
    const destCity   = f.destination?.city ?? f.destination?.code ?? '–';
    const destCode   = f.destination?.code ?? '';
    const scheduledOff = f.scheduled_off ?? null;
    const estimatedOff = f.estimated_off ?? null;
    const displayStatus = computeDisplayStatus('departures', f.status, scheduledOff, estimatedOff);
    const primaryDepartureTime = scheduledOff ?? estimatedOff ?? null;
    departures.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(destCity),
      to:        destCity,
      toCode:    destCode,
      schedule:  formatDatetime(scheduledOff),
      actual:    formatDatetime(estimatedOff),
      status:    displayStatus,
      isTomorrow: isTomorrowFlight(primaryDepartureTime),
      rawTime:   scheduledOff ?? estimatedOff ?? '',
    });
  }
  departures.sort((a, b) => a.rawTime.localeCompare(b.rawTime));

  console.log(`Loaded ${arrivals.length} arrivals and ${departures.length} departures from local JSON.`);
  return {
    arrivals:   arrivals.map(stripRawTime),
    departures: departures.map(stripRawTime),
  };
};

