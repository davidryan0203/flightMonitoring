import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// ─── Configuration ────────────────────────────────────────────────────────────
const API_KEY      = 'cUMXuU3rMbSQfiAGVIMa4qMHbJGXN9Z7'; //[cite: 4]
const FAWARE_BASE  = 'https://aeroapi.flightaware.com/aeroapi'; //[cite: 4]
const INTELISYS_BASE = 'https://pal-api.intelisys.ca/restv1'; //[cite: 4]
const GOOSE_BAY_AIRPORT = 'YYR'; //[cite: 4]
const FLIGHTAWARE_AIRPORT = 'CYYR'; //[cite: 4]
const TIMEZONE     = 'America/Goose_Bay'; //[cite: 4]
const PORT         = 3001; //[cite: 4]
const INTELISYS_FLIGHT_TYPE_FILTER = 'flightType.code=S'; //[cite: 4]

const PUBLIC_DIR   = path.join(__dirname, 'public'); //[cite: 4]
const ADMIN_DATA_PATH = path.join(__dirname, 'admin_data.json'); //[cite: 4]

const INTELISYS_INTERVAL_MS = 3 * 60 * 1000; //[cite: 4]
const FLIGHTAWARE_INTERVAL_MS = 15 * 60 * 1000; //[cite: 4]

const DEFAULT_ADMIN_DATA = { //[cite: 4]
  displaySettings: { showApiFlights: true, showCustomFlights: true, maxRowsPerTable: 20 }, //[cite: 4]
  customFlights: { arrivals: [], departures: [] }, //[cite: 4]
}; //[cite: 4]

const sseClients = new Set(); //[cite: 4]

function broadcastReload() { //[cite: 4]
  console.log(`📡 Broadcasting reload to ${sseClients.size} connected client(s)…`); //[cite: 4]
  for (const client of sseClients) { //[cite: 4]
    client.write('event: reload\ndata: true\n\n'); //[cite: 4]
  } //[cite: 4]
} //[cite: 4]

function loadAdminData() { //[cite: 4]
  try { //[cite: 4]
    if (!fs.existsSync(ADMIN_DATA_PATH)) { //[cite: 4]
      fs.writeFileSync(ADMIN_DATA_PATH, JSON.stringify(DEFAULT_ADMIN_DATA, null, 2), 'utf-8'); //[cite: 4]
      return structuredClone(DEFAULT_ADMIN_DATA); //[cite: 4]
    } //[cite: 4]
    const raw = JSON.parse(fs.readFileSync(ADMIN_DATA_PATH, 'utf-8')); //[cite: 4]
    return { //[cite: 4]
      displaySettings: { ...DEFAULT_ADMIN_DATA.displaySettings, ...(raw.displaySettings ?? {}) }, //[cite: 4]
      customFlights: { arrivals: Array.isArray(raw.customFlights?.arrivals) ? raw.customFlights.arrivals : [], departures: Array.isArray(raw.customFlights?.departures) ? raw.customFlights.departures : [] }, //[cite: 4]
    }; //[cite: 4]
  } catch (err) { //[cite: 4]
    console.error('❌ Failed to load admin_data.json:', err.message); //[cite: 4]
    return structuredClone(DEFAULT_ADMIN_DATA); //[cite: 4]
  } //[cite: 4]
} //[cite: 4]

function saveAdminData(data) { fs.writeFileSync(ADMIN_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8'); } //[cite: 4]

let adminData = loadAdminData(); //[cite: 4]

function sanitizeCustomFlight(payload = {}, type) { //[cite: 4]
  const base = { id: payload.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, flight: String(payload.flight ?? '').trim(), airline: String(payload.airline ?? '').trim(), actual: String(payload.actual ?? '').trim(), status: String(payload.status ?? 'Scheduled').trim() || 'Scheduled', isTomorrow: Boolean(payload.isTomorrow) }; //[cite: 4]
  if (type === 'arrivals') return { ...base, from: String(payload.from ?? '').trim(), expected: String(payload.expected ?? '').trim() }; //[cite: 4]
  return { ...base, to: String(payload.to ?? '').trim(), schedule: String(payload.schedule ?? '').trim() }; //[cite: 4]
} //[cite: 4]

function validateCustomFlight(flight, type) { //[cite: 4]
  if (!flight.flight) return 'Flight number is required.'; //[cite: 4]
  if (!flight.airline) return 'Airline is required.'; //[cite: 4]
  if (type === 'arrivals') { if (!flight.from) return 'Origin is required for arrivals.'; if (!flight.expected) return 'Expected time is required for arrivals.'; } //[cite: 4]
  else { if (!flight.to) return 'Destination is required for departures.'; if (!flight.schedule) return 'Schedule time is required for departures.'; } //[cite: 4]
  return null; //[cite: 4]
} //[cite: 4]

app.get('/api/events', (req, res) => { //[cite: 4]
  res.setHeader('Content-Type', 'text/event-stream'); //[cite: 4]
  res.setHeader('Cache-Control', 'no-cache'); //[cite: 4]
  res.setHeader('Connection', 'keep-alive'); //[cite: 4]
  res.flushHeaders(); //[cite: 4]

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000); //[cite: 4]
  sseClients.add(res); //[cite: 4]
  console.log(`✅ SSE client connected (total: ${sseClients.size})`); //[cite: 4]

  req.on('close', () => { //[cite: 4]
    clearInterval(heartbeat); //[cite: 4]
    sseClients.delete(res); //[cite: 4]
    console.log(`❌ SSE client disconnected (total: ${sseClients.size})`); //[cite: 4]
  }); //[cite: 4]
}); //[cite: 4]

const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']); //[cite: 4]
const HALIFAX_CODES = new Set(['YHZ', 'CYHZ', 'YHC', 'CYHC']); // Updated to align with IATA and ICAO variants

function formatDateKeyInTimeZone(dateInput, timeZone = TIMEZONE) { //[cite: 4]
  const parts = new Intl.DateTimeFormat('en-CA', { //[cite: 4]
    timeZone, //[cite: 4]
    year: 'numeric', month: '2-digit', day: '2-digit', //[cite: 4]
  }).formatToParts(new Date(dateInput)); //[cite: 4]
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])); //[cite: 4]
  return [map.year, map.month, map.day].join('-'); //[cite: 4]
} //[cite: 4]

function normalizeOperatorCode(code = '') { return String(code).trim().toUpperCase(); } //[cite: 4]

// Case-insensitive check to identify Halifax origins/destinations via standard airport sets
function isHalifaxFlight(flight, type = 'arrivals') {
  const code = type === 'arrivals' 
    ? normalizeOperatorCode(flight?.origin?.code)
    : normalizeOperatorCode(flight?.destination?.code);
  return HALIFAX_CODES.has(code);
}

// Strict tracking validator for specific flight aware operator routes
function hasAllowedIdent(flight) {
  const ident = normalizeOperatorCode(flight?.ident);
  return ident.startsWith('PVL') || ident.startsWith('ACA') || ident.startsWith('AC');
}

function deriveStatus(scheduledIso, estimatedIso, rawStatus = '', cancelled = false) { //[cite: 4]
  if (cancelled) return 'Cancelled'; //[cite: 4]
  let cleanRaw = String(rawStatus || '').trim();
  if (cleanRaw.toLowerCase() === 'scheduled') {
    cleanRaw = 'On Time'; // Fallback word string override sync
  }
  if (!scheduledIso || !estimatedIso) return cleanRaw || 'On Time'; //[cite: 4]
  const diff = (new Date(estimatedIso) - new Date(scheduledIso)) / 60000; //[cite: 4]
  if (diff > 1) return 'Delayed'; //[cite: 4]
  if (diff < -1) return 'Early'; //[cite: 4]
  return cleanRaw || 'On Time'; //[cite: 4]
} //[cite: 4]

function buildAirportSummary(airport = {}) { //[cite: 4]
  const code = airport.code ?? airport.code_iata ?? airport.code_icao ?? ''; //[cite: 4]
  return { //[cite: 4]
    code, //[cite: 4]
    code_icao: airport.code_icao ?? code, //[cite: 4]
    code_iata: airport.code_iata ?? code, //[cite: 4]
    code_lid: airport.code_lid ?? null, //[cite: 4]
    timezone: airport.timezone ?? TIMEZONE, //[cite: 4]
    name: airport.name ?? airport.city ?? code, //[cite: 4]
    city: airport.city ?? airport.name ?? code, //[cite: 4]
    airport_info_url: airport.airport_info_url ?? null, //[cite: 4]
  }; //[cite: 4]
} //[cite: 4]

function isIntelisysArrival(flight) { //[cite: 4]
  return normalizeOperatorCode(flight?.arrival?.airport?.code) === GOOSE_BAY_AIRPORT; //[cite: 4]
} //[cite: 4]

function isIntelisysDeparture(flight) { //[cite: 4]
  return normalizeOperatorCode(flight?.departure?.airport?.code) === GOOSE_BAY_AIRPORT; //[cite: 4]
} //[cite: 4]

function mapIntelisysFlight(status, leg, type) { //[cite: 4]
  const isArrival = type === 'arrivals'; //[cite: 4]
  const flightNumber = String(status?.flightNumber ?? '').trim(); //[cite: 4]
  const operatorCode = normalizeOperatorCode(status?.airlineCode?.code); //[cite: 4]
  const displayOperator = operatorCode === 'PB' ? 'PVL' : operatorCode; //[cite: 4]
  
  const expectedIso = isArrival //[cite: 4]
    ? (leg?.arrival?.estimatedTime ?? leg?.departure?.estimatedTime ?? null) //[cite: 4]
    : (leg?.departure?.estimatedTime ?? leg?.flightLeg?.departure?.estimatedTime ?? null); //[cite: 4]

  const actualIso = isArrival //[cite: 4]
    ? (leg?.flightLeg?.arrival?.scheduledTime ?? null) //[cite: 4]
    : (leg?.departure?.scheduledTime ?? leg?.flightLeg?.departure?.scheduledTime ?? null); //[cite: 4]

  const originAirport = buildAirportSummary(leg?.departure?.airport ?? {}); //[cite: 4]
  const destinationAirport = buildAirportSummary(leg?.arrival?.airport ?? {}); //[cite: 4]
  const airportCity = isArrival ? originAirport.city : destinationAirport.city; //[cite: 4]

  return { //[cite: 4]
    ident: `${displayOperator}${flightNumber}`, //[cite: 4]
    ident_icao: `${displayOperator}${flightNumber}`, //[cite: 4]
    ident_iata: `${operatorCode === 'PB' ? 'PB' : displayOperator}${flightNumber}`, //[cite: 4]
    actual_runway_off: isArrival ? null : (leg?.departure?.utcActualOffShortTime ?? null), //[cite: 4]
    actual_runway_on: isArrival ? (leg?.arrival?.utcActualInShortTime ?? null) : null, //[cite: 4]
    fa_flight_id: `intelisys-${type}-${flightNumber}-${actualIso ?? expectedIso ?? Date.now()}`, //[cite: 4]
    operator: displayOperator, //[cite: 4]
    operator_icao: displayOperator, //[cite: 4]
    operator_iata: operatorCode === 'PB' ? 'PB' : displayOperator, //[cite: 4]
    flight_number: flightNumber, //[cite: 4]
    registration: leg?.tail?.identifier ?? null, //[cite: 4]
    atc_ident: null, //[cite: 4]
    inbound_fa_flight_id: null, //[cite: 4]
    codeshares: [], //[cite: 4]
    codeshares_iata: [], //[cite: 4]
    blocked: false, //[cite: 4]
    diverted: false, //[cite: 4]
    cancelled: Boolean(leg?.flightLegStatus?.cancelled), //[cite: 4]
    position_only: false, //[cite: 4]
    origin: originAirport, //[cite: 4]
    destination: destinationAirport, //[cite: 4]
    departure_delay: 0, //[cite: 4]
    arrival_delay: 0, //[cite: 4]
    filed_ete: null, //[cite: 4]
    scheduled_out: isArrival ? null : actualIso, //[cite: 4]
    estimated_out: isArrival ? null : expectedIso, //[cite: 4]
    actual_out: isArrival ? null : actualIso, //[cite: 4]
    scheduled_off: isArrival ? null : actualIso, //[cite: 4]
    estimated_off: isArrival ? null : expectedIso, //[cite: 4]
    actual_off: isArrival ? null : actualIso, //[cite: 4]
    scheduled_on: isArrival ? actualIso : null, //[cite: 4]
    estimated_on: isArrival ? expectedIso : null, //[cite: 4]
    actual_on: isArrival ? actualIso : null, //[cite: 4]
    scheduled_in: isArrival ? actualIso : null, //[cite: 4]
    estimated_in: isArrival ? expectedIso : null, //[cite: 4]
    actual_in: isArrival ? actualIso : null, //[cite: 4]
    expected: expectedIso, //[cite: 4]
    actual: actualIso, //[cite: 4]
    progress_percent: 0, //[cite: 4]
    status: deriveStatus(actualIso, expectedIso, 'On Time', Boolean(leg?.flightLegStatus?.cancelled)), // Synchronized label assignment
    aircraft_type: leg?.aircraftModel?.identifier ?? null, //[cite: 4]
    route_distance: leg?.distance?.length ?? null, //[cite: 4]
    filed_airspeed: null, //[cite: 4]
    filed_altitude: null, //[cite: 4]
    route: null, //[cite: 4]
    baggage_claim: null, //[cite: 4]
    seats_cabin_business: null, //[cite: 4]
    seats_cabin_coach: null, //[cite: 4]
    seats_cabin_first: null, //[cite: 4]
    gate_origin: null, //[cite: 4]
    gate_destination: null, //[cite: 4]
    terminal_origin: null, //[cite: 4]
    terminal_destination: null, //[cite: 4]
    type: 'Airline', //[cite: 4]
    airline: AIR_BOREALIS_CITIES.has(airportCity) ? 'Air Borealis' : 'PAL Airlines', //[cite: 4]
    isTomorrow: false, //[cite: 4]
    source: 'intelisys', //[cite: 4]
  }; //[cite: 4]
} //[cite: 4]

function mapFlightAwareFlight(flight) { return { ...flight, source: 'flightaware' }; } //[cite: 4]

function dedupeFlights(rows) { //[cite: 4]
  const seen = new Map(); //[cite: 4]
  for (const row of rows) { //[cite: 4]
    const key = [row.ident ?? '', row.scheduled_on ?? row.scheduled_off ?? '', row.origin?.code ?? '', row.destination?.code ?? ''].join('|'); //[cite: 4]
    if (!seen.has(key)) seen.set(key, row); //[cite: 4]
  } //[cite: 4]
  return [...seen.values()]; //[cite: 4]
} //[cite: 4]

async function fetchIntelisysStatuses(query) { //[cite: 4]
  const response = await fetch(`${INTELISYS_BASE}/flightstatuses?${query}`); //[cite: 4]
  if (!response.ok) throw new Error(`Intelisys API error: ${response.status}`); //[cite: 4]
  const data = await response.json(); //[cite: 4]
  return Array.isArray(data) ? data : []; //[cite: 4]
} //[cite: 4]

async function fetchFlightAwareData() { //[cite: 4]
  const headers = { 'x-apikey': API_KEY }; //[cite: 4]
  const [arrivalsRes, departuresRes] = await Promise.all([ //[cite: 4]
    fetch(`${FAWARE_BASE}/airports/${FLIGHTAWARE_AIRPORT}/flights/scheduled_arrivals`, { headers }), //[cite: 4]
    fetch(`${FAWARE_BASE}/airports/${FLIGHTAWARE_AIRPORT}/flights/scheduled_departures`, { headers }), //[cite: 4]
  ]); //[cite: 4]
  if (!arrivalsRes.ok) throw new Error(`Arrivals API error: ${arrivalsRes.status}`); //[cite: 4]
  if (!departuresRes.ok) throw new Error(`Departures API error: ${departuresRes.status}`); //[cite: 4]
  
  const [arrivalsData, departuresData] = await Promise.all([arrivalsRes.json(), departuresRes.json()]); //[cite: 4]
  const rawArrivals = arrivalsData.scheduled_arrivals ?? arrivalsData.flights ?? []; //[cite: 4]
  const rawDepartures = departuresData.scheduled_departures ?? departuresData.flights ?? []; //[cite: 4]

  // Synchronized Filter Logic: Halifax isolation + strict operator check profiles
  const filteredArrivals = rawArrivals.filter(f => isHalifaxFlight(f, 'arrivals') && hasAllowedIdent(f));
  const filteredDepartures = rawDepartures.filter(f => isHalifaxFlight(f, 'departures') && hasAllowedIdent(f));

  return {
    arrivals: filteredArrivals.map(mapFlightAwareFlight), //[cite: 4]
    departures: filteredDepartures.map(mapFlightAwareFlight), //[cite: 4]
  };
}

function writeFlightFiles(arrivalsData, departuresData, source = 'intelisys') { //[cite: 4]
  if (source === 'flightaware') { //[cite: 4]
    fs.writeFileSync(path.join(PUBLIC_DIR, 'flightaware_arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8'); //[cite: 4]
    fs.writeFileSync(path.join(PUBLIC_DIR, 'flightaware_departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8'); //[cite: 4]
  } else { //[cite: 4]
    fs.writeFileSync(path.join(PUBLIC_DIR, 'arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8'); //[cite: 4]
    fs.writeFileSync(path.join(PUBLIC_DIR, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8'); //[cite: 4]
    fs.writeFileSync(path.join(__dirname, 'arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8'); //[cite: 4]
    fs.writeFileSync(path.join(__dirname, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8'); //[cite: 4]
  } //[cite: 4]
} //[cite: 4]

async function fetchAndSaveIntelisysData() { //[cite: 4]
  const dateKey = formatDateKeyInTimeZone(new Date(), TIMEZONE); //[cite: 4]
  try { //[cite: 4]
    const [intelisysArrivals, intelisysDepartures] = await Promise.all([ //[cite: 4]
      fetchIntelisysStatuses(`arrivalAirport=${GOOSE_BAY_AIRPORT}&arrival=${dateKey}&${INTELISYS_FLIGHT_TYPE_FILTER}`).catch(() => []), //[cite: 4]
      fetchIntelisysStatuses(`departureAirport=${GOOSE_BAY_AIRPORT}&departure=${dateKey}&${INTELISYS_FLIGHT_TYPE_FILTER}`).catch(() => []), //[cite: 4]
    ]); //[cite: 4]

    const intelisysArrivalRows = []; //[cite: 4]
    for (const status of intelisysArrivals) { //[cite: 4]
      const flightNumber = String(status?.flightNumber ?? '').trim(); //[cite: 4]
      if (!flightNumber.startsWith('9')) continue; //[cite: 4]
      for (const leg of (status?.legs ?? [])) { //[cite: 4]
        if (isIntelisysArrival(leg)) intelisysArrivalRows.push(mapIntelisFlight(status, leg, 'arrivals')); //[cite: 4]
      } //[cite: 4]
    } //[cite: 4]

    const intelisysDepartureRows = []; //[cite: 4]
    for (const status of intelisysDepartures) { //[cite: 4]
      const flightNumber = String(status?.flightNumber ?? '').trim(); //[cite: 4]
      if (!flightNumber.startsWith('9')) continue; //[cite: 4]
      for (const leg of (status?.legs ?? [])) { //[cite: 4]
        if (isIntelisysDeparture(leg)) intelisysDepartureRows.push(mapIntelisysFlight(status, leg, 'departures')); //[cite: 4]
      } //[cite: 4]
    } //[cite: 4]

    const arrivals = dedupeFlights(intelisysArrivalRows); //[cite: 4]
    const departures = dedupeFlights(intelisysDepartureRows); //[cite: 4]

    writeFlightFiles( //[cite: 4]
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'intelisys', scheduled_arrivals: arrivals }, //[cite: 4]
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'intelisys', scheduled_departures: departures }, //[cite: 4]
      'intelisys' //[cite: 4]
    ); //[cite: 4]
    broadcastReload(); //[cite: 4]
    return { success: true }; //[cite: 4]
  } catch (err) { //[cite: 4]
    return { success: false, error: err.message }; //[cite: 4]
  } //[cite: 4]
} //[cite: 4]

async function fetchAndSaveFlightAwareData() { //[cite: 4]
  const dateKey = formatDateKeyInTimeZone(new Date(), TIMEZONE); //[cite: 4]
  try { //[cite: 4]
    const flightAware = await fetchFlightAwareData().catch(() => ({ arrivals: [], departures: [] })); //[cite: 4]
    const arrivals = dedupeFlights(flightAware.arrivals); //[cite: 4]
    const departures = dedupeFlights(flightAware.departures); //[cite: 4]

    writeFlightFiles( //[cite: 4]
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'flightaware', scheduled_arrivals: arrivals }, //[cite: 4]
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'flightaware', scheduled_departures: departures }, //[cite: 4]
      'flightaware' //[cite: 4]
    ); //[cite: 4]
    broadcastReload(); //[cite: 4]
    return { success: true }; //[cite: 4]
  } catch (err) { //[cite: 4]
    return { success: false, error: err.message }; //[cite: 4]
  } //[cite: 4]
} //[cite: 4]

function startScheduler() { //[cite: 4]
  fetchAndSaveIntelisysData(); //[cite: 4]
  fetchAndSaveFlightAwareData(); //[cite: 4]
  setInterval(fetchAndSaveIntelisysData, INTELISYS_INTERVAL_MS); //[cite: 4]
  setInterval(fetchAndSaveFlightAwareData, FLIGHTAWARE_INTERVAL_MS); //[cite: 4]
} //[cite: 4]

app.post('/api/refresh', async (req, res) => { //[cite: 4]
  try { //[cite: 4]
    await Promise.all([fetchAndSaveIntelisysData(), fetchAndSaveFlightAwareData()]); //[cite: 4]
    res.json({ success: true }); //[cite: 4]
  } catch (err) { //[cite: 4]
    res.status(500).json({ success: false, error: err.message }); //[cite: 4]
  } //[cite: 4]
}); //[cite: 4]

app.get('/api/admin/state', (req, res) => { res.json(adminData); }); //[cite: 4]
app.listen(PORT, () => { startScheduler(); }); //[cite: 4]