// ── Configuration ────────────────────────────────────────────────────────────
const TIMEZONE        = 'America/Goose_Bay'; //[cite: 3]
const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']); //[cite: 3]
const EXCLUDED_ORIGIN = 'CVB2'; //[cite: 3]

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDatetime(isoString) { //[cite: 3]
  if (!isoString) return ''; //[cite: 3]
  try { //[cite: 3]
    return new Date(isoString).toLocaleTimeString('en-CA', { //[cite: 3]
      timeZone: TIMEZONE, //[cite: 3]
      hour: 'numeric', //[cite: 3]
      minute: '2-digit', //[cite: 3]
      hour12: true, //[cite: 3]
    }); //[cite: 3]
  } catch { return ''; } //[cite: 3]
} //[cite: 3]

function toLocalMinutesOfDay(isoString) { //[cite: 3]
  if (!isoString) return null; //[cite: 3]
  try { //[cite: 3]
    const parts = new Intl.DateTimeFormat('en-CA', { //[cite: 3]
      timeZone: TIMEZONE, //[cite: 3]
      hour: 'numeric', //[cite: 3]
      minute: '2-digit', //[cite: 3]
      hour12: true, //[cite: 3]
    }).formatToParts(new Date(isoString)); //[cite: 3]

    const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); //[cite: 3]
    const rawHour = Number(map.hour); //[cite: 3]
    const rawMinute = Number(map.minute); //[cite: 3]
    const dayPeriod = (map.dayPeriod || '').toLowerCase(); //[cite: 3]

    if (Number.isNaN(rawHour) || Number.isNaN(rawMinute)) return null; //[cite: 3]
    let hour24 = rawHour % 12; //[cite: 3]
    if (dayPeriod.includes('p')) hour24 += 12; //[cite: 3]

    return hour24 * 60 + rawMinute; //[cite: 3]
  } catch { return null; } //[cite: 3]
} //[cite: 3]

function deriveStatus(scheduledIso, estimatedIso) { //[cite: 3]
  if (!scheduledIso || !estimatedIso) return 'On Time'; //[cite: 3]
  const diff = (new Date(estimatedIso) - new Date(scheduledIso)) / 60000; //[cite: 3]
  if (diff > 1)  return 'Delayed'; //[cite: 3]
  if (diff < -1) return 'Early'; //[cite: 3]
  return 'On Time'; //[cite: 3]
} //[cite: 3]

function computeDisplayStatus(type, rawStatus, scheduledIso, estimatedIso) { //[cite: 3]
  void type; //[cite: 3]
  const cleanRaw = String(rawStatus || '').trim(); // Synchronized text normalize check
  if (cleanRaw.toLowerCase() === 'scheduled' || cleanRaw.toLowerCase() === 'on time') return 'On Time'; //[cite: 3]
  if (cleanRaw.toLowerCase().includes('delayed')) return 'Delayed'; //[cite: 3]

  const scheduledMins = toLocalMinutesOfDay(scheduledIso); //[cite: 3]
  const estimatedMins = toLocalMinutesOfDay(estimatedIso); //[cite: 3]

  if (scheduledMins !== null && estimatedMins !== null) { //[cite: 3]
    if (scheduledMins < estimatedMins) return 'Delayed'; //[cite: 3]
    if (scheduledMins > estimatedMins) return 'Early'; //[cite: 3]
    return 'On Time'; //[cite: 3]
  } //[cite: 3]

  return cleanRaw || deriveStatus(scheduledIso, estimatedIso); //[cite: 3]
} //[cite: 3]

function stripRawTime(flight) { //[cite: 3]
  return { //[cite: 3]
    flight: flight.flight, //[cite: 3]
    airline: flight.airline, //[cite: 3]
    from: flight.from, //[cite: 3]
    fromCode: flight.fromCode, //[cite: 3]
    expected: flight.expected, //[cite: 3]
    actual: flight.actual, //[cite: 3]
    status: flight.status, //[cite: 3]
    to: flight.to, //[cite: 3]
    toCode: flight.toCode, //[cite: 3]
    schedule: flight.schedule, //[cite: 3]
    isTomorrow: flight.isTomorrow, //[cite: 3]
    rawTime: flight.rawTime, //[cite: 3]
  }; //[cite: 3]
} //[cite: 3]

function resolveAirline(city) { //[cite: 3]
  if (city === 'Halifax') return 'Air Canada'; //[cite: 3]
  if (AIR_BOREALIS_CITIES.has(city)) return 'Air Borealis'; //[cite: 3]
  return 'PAL Airlines'; //[cite: 3]
} //[cite: 3]

// ── Ingestion Processors with 2-Hour Filter Cut-Offs ──────────────────────────
function processArrivals(rawArrivals = [], cutoffTimestamp) { //[cite: 3]
  const arrivals = []; //[cite: 3]
  for (const f of rawArrivals) { //[cite: 3]
    const originCode = f.origin?.code ?? ''; //[cite: 3]
    if (originCode === EXCLUDED_ORIGIN) continue; //[cite: 3]
    
    const expectedIso = f.expected ?? f.estimated_on ?? f.estimated_in ?? null; //[cite: 3]
    const scheduledOn = f.actual ?? f.scheduled_on ?? f.scheduled_in ?? null; //[cite: 3]
    const rawTime = scheduledOn ?? expectedIso ?? ''; //[cite: 3]

    // Time window cut-off filter check (drops rows older than 2 hours ago)
    if (rawTime && new Date(rawTime).getTime() < cutoffTimestamp) continue;

    const originCity  = f.origin?.city ?? originCode ?? '–'; //[cite: 3]
    let displayStatus = computeDisplayStatus('arrivals', f.status, scheduledOn, expectedIso); //[cite: 3]
    if (f.cancelled || f.flightLegStatus?.cancelled) displayStatus = 'Cancelled'; //[cite: 3]

    arrivals.push({ //[cite: 3]
      flight:    f.ident ?? '–', //[cite: 3]
      airline:   resolveAirline(originCity), //[cite: 3]
      from:      originCity, //[cite: 3]
      fromCode:  originCode, //[cite: 3]
      expected:  formatDatetime(expectedIso), //[cite: 3]
      actual:    formatDatetime(scheduledOn), //[cite: 3]
      status:    displayStatus, //[cite: 3]
      isTomorrow: false, //[cite: 3]
      rawTime:   rawTime, //[cite: 3]
      source:    f.source ?? 'unknown', //[cite: 3]
    }); //[cite: 3]
  } //[cite: 3]
  return arrivals; //[cite: 3]
} //[cite: 3]

function processDepartures(rawDepartures = [], cutoffTimestamp) { //[cite: 3]
  const departures = []; //[cite: 3]
  for (const f of rawDepartures) { //[cite: 3]
    const expectedOff = f.expected ?? f.estimated_off ?? f.estimated_out ?? null; //[cite: 3]
    const scheduledOff = f.actual ?? f.scheduled_off ?? f.scheduled_out ?? null; //[cite: 3]
    const rawTime = scheduledOff ?? expectedOff ?? ''; //[cite: 3]

    // Time window cut-off filter check (drops rows older than 2 hours ago)
    if (rawTime && new Date(rawTime).getTime() < cutoffTimestamp) continue;

    const destCity   = f.destination?.city ?? f.destination?.code ?? '–'; //[cite: 3]
    const destCode   = f.destination?.code ?? ''; //[cite: 3]
    let displayStatus = computeDisplayStatus('departures', f.status, scheduledOff, expectedOff); //[cite: 3]
    if (f.cancelled || f.flightLegStatus?.cancelled) displayStatus = 'Cancelled'; //[cite: 3]
    
    departures.push({ //[cite: 3]
      flight:    f.ident ?? '–', //[cite: 3]
      airline:   resolveAirline(destCity), //[cite: 3]
      to:        destCity, //[cite: 3]
      toCode:    destCode, //[cite: 3]
      schedule:  formatDatetime(expectedOff), //[cite: 3]
      actual:    formatDatetime(scheduledOff), //[cite: 3]
      status:    displayStatus, //[cite: 3]
      isTomorrow: false, //[cite: 3]
      rawTime:   rawTime, //[cite: 3]
      source:    f.source ?? 'unknown', //[cite: 3]
    }); //[cite: 3]
  } //[cite: 3]
  return departures; //[cite: 3]
} //[cite: 3]

function deduplicateFlights(flights) { //[cite: 3]
  const seen = new Map(); //[cite: 3]
  const unique = []; //[cite: 3]
  for (const flight of flights) { //[cite: 3]
    const key = `${flight.flight}|${flight.rawTime}`; //[cite: 3]
    if (!seen.has(key)) { //[cite: 3]
      seen.set(key, true); //[cite: 3]
      unique.push(flight); //[cite: 3]
    } //[cite: 4]
  } //[cite: 3]
  return unique; //[cite: 3]
} //[cite: 3]

export const fetchFlightData = async () => { //[cite: 3]
  const [intelisysArrivalsRes, intelisysDeparturesRes, flightawareArrivalsRes, flightawareDeparturesRes] = await Promise.all([ //[cite: 3]
    fetch('/arrivals.json').catch(() => null), //[cite: 3]
    fetch('/departures.json').catch(() => null), //[cite: 3]
    fetch('/flightaware_arrivals.json').catch(() => null), //[cite: 3]
    fetch('/flightaware_departures.json').catch(() => null), //[cite: 3]
  ]); //[cite: 3]

  let intelisysArrivals = [], intelisysDepartures = [], flightawareArrivals = [], flightawareDepartures = []; //[cite: 3]

  if (intelisysArrivalsRes?.ok) intelisysArrivals = (await intelisysArrivalsRes.json()).scheduled_arrivals ?? []; //[cite: 3]
  if (intelisysDeparturesRes?.ok) intelisysDepartures = (await intelisysDeparturesRes.json()).scheduled_departures ?? []; //[cite: 3]
  if (flightawareArrivalsRes?.ok) flightawareArrivals = (await flightawareArrivalsRes.json()).scheduled_arrivals ?? []; //[cite: 3]
  if (flightawareDeparturesRes?.ok) flightawareDepartures = (await flightawareDeparturesRes.json()).scheduled_departures ?? []; //[cite: 3]

  // Establish historical 2-hour filter threshold relative to the active execution runtime
  const cutoffTimestamp = Date.now() - (2 * 3600 * 1000);

  const allArrivals = [...processArrivals(intelisysArrivals, cutoffTimestamp), ...processArrivals(flightawareArrivals, cutoffTimestamp)]; //[cite: 3]
  const arrivals = deduplicateFlights(allArrivals); //[cite: 3]
  
  // Real chronological numeric sorting instead of character strings comparison matches
  arrivals.sort((a, b) => new Date(a.rawTime).getTime() - new Date(b.rawTime).getTime());

  const allDepartures = [...processDepartures(intelisysDepartures, cutoffTimestamp), ...processDepartures(flightawareDepartures, cutoffTimestamp)]; //[cite: 3]
  const departures = deduplicateFlights(allDepartures); //[cite: 3]
  departures.sort((a, b) => new Date(a.rawTime).getTime() - new Date(b.rawTime).getTime());

  return {
    arrivals:   arrivals.map(stripRawTime), //[cite: 3]
    departures: departures.map(stripRawTime), //[cite: 3]
  };
};