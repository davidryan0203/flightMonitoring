// ── Configuration ────────────────────────────────────────────────────────────
const TIMEZONE        = 'America/Goose_Bay';
const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']);
const EXCLUDED_ORIGIN = 'CVB2';

// ── Helpers ──────────────────────────────────────────────────────────────────
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

    if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) return null;
    let hour24 = rawHour % 12;
    if (dayPeriod.includes('p')) hour24 += 12;

    return hour24 * 60 + rawMinute;
  } catch { return null; }
}

function deriveStatus(scheduledIso, estimatedIso) {
  if (!scheduledIso || !estimatedIso) return 'On Time';
  const diff = (new Date(estimatedIso) - new Date(scheduledIso)) / 60000;
  if (diff > 1)  return 'Delayed';
  if (diff < -1) return 'Early';
  return 'On Time';
}

function computeDisplayStatus(type, rawStatus, scheduledIso, estimatedIso) {
  void type;
  const cleanRaw = String(rawStatus || '').trim(); 
  if (cleanRaw.toLowerCase() === 'scheduled' || cleanRaw.toLowerCase() === 'on time') return 'On Time';
  if (cleanRaw.toLowerCase().includes('delayed')) return 'Delayed';

  const scheduledMins = toLocalMinutesOfDay(scheduledIso);
  const estimatedMins = toLocalMinutesOfDay(estimatedIso);

  if (scheduledMins !== null && estimatedMins !== null) {
    if (scheduledMins < estimatedMins) return 'Delayed';
    if (scheduledMins > estimatedMins) return 'Early';
    return 'On Time';
  }

  return cleanRaw || deriveStatus(scheduledIso, estimatedIso);
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

function resolveAirline(city) {
  if (city === 'Halifax') return 'Air Canada';
  if (AIR_BOREALIS_CITIES.has(city)) return 'Air Borealis';
  return 'PAL Airlines';
}

function checkIsTomorrow(isoString) {
  if (!isoString) return false;
  try {
    const flightDate = new Date(isoString);
    const targetDateStr = flightDate.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    const localNowStr = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    return targetDateStr > localNowStr;
  } catch { return false; }
}

function processArrivals(rawArrivals = [], cutoffTimestamp) {
  const arrivals = [];
  for (const f of rawArrivals) {
    const originCode = f.origin?.code ?? '';
    if (originCode === EXCLUDED_ORIGIN) continue;
    
    const expectedIso = f.expected ?? f.estimated_on ?? f.estimated_in ?? null;
    const scheduledOn = f.actual ?? f.scheduled_on ?? f.scheduled_in ?? null;
    const rawTime = scheduledOn ?? expectedIso ?? '';

    if (rawTime && new Date(rawTime).getTime() < cutoffTimestamp) continue;

    const originCity  = f.origin?.city ?? originCode ?? '–';
    let displayStatus = computeDisplayStatus('arrivals', f.status, scheduledOn, expectedIso);
    if (f.cancelled || f.flightLegStatus?.cancelled) displayStatus = 'Cancelled';

    arrivals.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(originCity),
      from:      originCity,
      fromCode:  originCode,
      expected:  formatDatetime(expectedIso),
      actual:    formatDatetime(scheduledOn),
      status:    displayStatus,
      isTomorrow: checkIsTomorrow(rawTime),
      rawTime:   rawTime,
      source:    f.source ?? 'unknown',
    });
  }
  return arrivals;
}

function processDepartures(rawDepartures = [], cutoffTimestamp) {
  const departures = [];
  for (const f of rawDepartures) {
    const expectedOff = f.expected ?? f.estimated_off ?? f.estimated_out ?? null;
    const scheduledOff = f.actual ?? f.scheduled_off ?? f.scheduled_out ?? null;
    const rawTime = scheduledOff ?? expectedOff ?? '';

    if (rawTime && new Date(rawTime).getTime() < cutoffTimestamp) continue;

    const destCity   = f.destination?.city ?? f.destination?.code ?? '–';
    const destCode   = f.destination?.code ?? '';
    let displayStatus = computeDisplayStatus('departures', f.status, scheduledOff, expectedOff);
    if (f.cancelled || f.flightLegStatus?.cancelled) displayStatus = 'Cancelled';
    
    departures.push({
      flight:    f.ident ?? '–',
      airline:   resolveAirline(destCity),
      to:        destCity,
      toCode:    destCode,
      schedule:  formatDatetime(expectedOff),
      actual:    formatDatetime(scheduledOff),
      status:    displayStatus,
      isTomorrow: checkIsTomorrow(rawTime),
      rawTime:   rawTime,
      source:    f.source ?? 'unknown',
    });
  }
  return departures;
}

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

export const fetchFlightData = async () => {
  const [intelisysArrivalsRes, intelisysDeparturesRes, flightawareArrivalsRes, flightawareDeparturesRes] = await Promise.all([
    fetch('/arrivals.json').catch(() => null),
    fetch('/departures.json').catch(() => null),
    fetch('/flightaware_arrivals.json').catch(() => null),
    fetch('/flightaware_departures.json').catch(() => null),
  ]);

  let intelisysArrivals = [], intelisysDepartures = [], flightawareArrivals = [], flightawareDepartures = [];

  if (intelisysArrivalsRes?.ok) intelisysArrivals = (await intelisysArrivalsRes.json()).scheduled_arrivals ?? [];
  if (intelisysDeparturesRes?.ok) intelisysDepartures = (await intelisysDeparturesRes.json()).scheduled_departures ?? [];
  if (flightawareArrivalsRes?.ok) flightawareArrivals = (await flightawareArrivalsRes.json()).scheduled_arrivals ?? [];
  if (flightawareDeparturesRes?.ok) flightawareDepartures = (await flightawareDeparturesRes.json()).scheduled_departures ?? [];

  const cutoffTimestamp = Date.now() - (2 * 3600 * 1000);

  const allArrivals = [...processArrivals(intelisysArrivals, cutoffTimestamp), ...processArrivals(flightawareArrivals, cutoffTimestamp)];
  const arrivals = deduplicateFlights(allArrivals);
  arrivals.sort((a, b) => new Date(a.rawTime).getTime() - new Date(b.rawTime).getTime());

  const allDepartures = [...processDepartures(intelisysDepartures, cutoffTimestamp), ...processDepartures(flightawareDepartures, cutoffTimestamp)];
  const departures = deduplicateFlights(allDepartures);
  departures.sort((a, b) => new Date(a.rawTime).getTime() - new Date(b.rawTime).getTime());

  return {
    arrivals:   arrivals.map(stripRawTime),
    departures: departures.map(stripRawTime),
  };
};