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
const API_KEY      = 'cUMXuU3rMbSQfiAGVIMa4qMHbJGXN9Z7';
const FAWARE_BASE  = 'https://aeroapi.flightaware.com/aeroapi';
const INTELISYS_BASE = 'https://pal-api.intelisys.ca/restv1';
const GOOSE_BAY_AIRPORT = 'YYR';
const FLIGHTAWARE_AIRPORT = 'CYYR';
const TIMEZONE     = 'America/Goose_Bay';
const PORT         = 3001;
const INTELISYS_FLIGHT_TYPE_FILTER = 'flightType.code=S';

const PUBLIC_DIR   = path.join(__dirname, 'public');
const ADMIN_DATA_PATH = path.join(__dirname, 'admin_data.json');

const INTELISYS_INTERVAL_MS = 3 * 60 * 1000;      
const FLIGHTAWARE_INTERVAL_MS = 15 * 60 * 1000;   

const DEFAULT_ADMIN_DATA = {
  displaySettings: { showApiFlights: true, showCustomFlights: true, maxRowsPerTable: 20 },
  customFlights: { arrivals: [], departures: [] },
};

const sseClients = new Set();

function broadcastReload() {
  console.log(`📡 Broadcasting reload to ${sseClients.size} connected client(s)…`);
  for (const client of sseClients) {
    client.write('event: reload\ndata: true\n\n');
  }
}

function loadAdminData() {
  try {
    if (!fs.existsSync(ADMIN_DATA_PATH)) {
      fs.writeFileSync(ADMIN_DATA_PATH, JSON.stringify(DEFAULT_ADMIN_DATA, null, 2), 'utf-8');
      return structuredClone(DEFAULT_ADMIN_DATA);
    }
    const raw = JSON.parse(fs.readFileSync(ADMIN_DATA_PATH, 'utf-8'));
    return {
      displaySettings: { ...DEFAULT_ADMIN_DATA.displaySettings, ...(raw.displaySettings ?? {}) },
      customFlights: { arrivals: Array.isArray(raw.customFlights?.arrivals) ? raw.customFlights.arrivals : [], departures: Array.isArray(raw.customFlights?.departures) ? raw.customFlights.departures : [] },
    };
  } catch (err) {
    console.error('❌ Failed to load admin_data.json:', err.message);
    return structuredClone(DEFAULT_ADMIN_DATA);
  }
}

function saveAdminData(data) { fs.writeFileSync(ADMIN_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8'); }

let adminData = loadAdminData();

function sanitizeCustomFlight(payload = {}, type) {
  const base = { id: payload.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2,8)}`, flight: String(payload.flight ?? '').trim(), airline: String(payload.airline ?? '').trim(), actual: String(payload.actual ?? '').trim(), status: String(payload.status ?? 'Scheduled').trim() || 'Scheduled', isTomorrow: Boolean(payload.isTomorrow) };
  if (type === 'arrivals') return { ...base, from: String(payload.from ?? '').trim(), expected: String(payload.expected ?? '').trim() };
  return { ...base, to: String(payload.to ?? '').trim(), schedule: String(payload.schedule ?? '').trim() };
}

function validateCustomFlight(flight, type) {
  if (!flight.flight) return 'Flight number is required.';
  if (!flight.airline) return 'Airline is required.';
  if (type === 'arrivals') { if (!flight.from) return 'Origin is required for arrivals.'; if (!flight.expected) return 'Expected time is required for arrivals.'; }
  else { if (!flight.to) return 'Destination is required for departures.'; if (!flight.schedule) return 'Schedule time is required for departures.'; }
  return null;
}

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);
  sseClients.add(res);
  console.log(`✅ SSE client connected (total: ${sseClients.size})`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`❌ SSE client disconnected (total: ${sseClients.size})`);
  });
});

const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']);
const HALIFAX_CODES = new Set(['YHZ', 'CYHZ', 'YHC', 'CYHC']);

function formatDateKeyInTimeZone(dateInput, timeZone = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(dateInput));
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return [map.year, map.month, map.day].join('-');
}

function normalizeOperatorCode(code = '') { return String(code).trim().toUpperCase(); }

function isHalifaxFlight(flight, type = 'arrivals') {
  const code = type === 'arrivals' 
    ? normalizeOperatorCode(flight?.origin?.code)
    : normalizeOperatorCode(flight?.destination?.code);
  return HALIFAX_CODES.has(code);
}

function hasAllowedIdent(flight) {
  const ident = normalizeOperatorCode(flight?.ident);
  return ident.startsWith('PVL') || ident.startsWith('ACA') || ident.startsWith('AC');
}

function deriveStatus(scheduledIso, estimatedIso, rawStatus = '', cancelled = false) {
  if (cancelled) return 'Cancelled';
  let cleanRaw = String(rawStatus || '').trim();
  if (cleanRaw.toLowerCase() === 'scheduled') {
    cleanRaw = 'On Time';
  }
  if (!scheduledIso || !estimatedIso) return cleanRaw || 'On Time';
  const diff = (new Date(estimatedIso) - new Date(scheduledIso)) / 60000;
  if (diff > 1) return 'Delayed';
  if (diff < -1) return 'Early';
  return cleanRaw || 'On Time';
}

function buildAirportSummary(airport = {}) {
  const code = airport.code ?? airport.code_iata ?? airport.code_icao ?? '';
  return {
    code,
    code_icao: airport.code_icao ?? code,
    code_iata: airport.code_iata ?? code,
    code_lid: airport.code_lid ?? null,
    timezone: airport.timezone ?? TIMEZONE,
    name: airport.name ?? airport.city ?? code,
    city: airport.city ?? airport.name ?? code,
    airport_info_url: airport.airport_info_url ?? null,
  };
}

function isIntelisysArrival(flight) {
  return normalizeOperatorCode(flight?.arrival?.airport?.code) === GOOSE_BAY_AIRPORT;
}

function isIntelisysDeparture(flight) {
  return normalizeOperatorCode(flight?.departure?.airport?.code) === GOOSE_BAY_AIRPORT;
}

function mapIntelisysFlight(status, leg, type) {
  const isArrival = type === 'arrivals';
  const flightNumber = String(status?.flightNumber ?? '').trim();
  const operatorCode = normalizeOperatorCode(status?.airlineCode?.code);
  const displayOperator = operatorCode === 'PB' ? 'PVL' : operatorCode;
  
  const expectedIso = isArrival 
    ? (leg?.arrival?.estimatedTime ?? leg?.departure?.estimatedTime ?? null)
    : (leg?.departure?.estimatedTime ?? leg?.flightLeg?.departure?.estimatedTime ?? null);

  const actualIso = isArrival
    ? (leg?.flightLeg?.arrival?.scheduledTime ?? null)
    : (leg?.departure?.scheduledTime ?? leg?.flightLeg?.departure?.scheduledTime ?? null);

  const originAirport = buildAirportSummary(leg?.departure?.airport ?? {});
  const destinationAirport = buildAirportSummary(leg?.arrival?.airport ?? {});
  const airportCity = isArrival ? originAirport.city : destinationAirport.city;

  return {
    ident: `${displayOperator}${flightNumber}`,
    ident_icao: `${displayOperator}${flightNumber}`,
    ident_iata: `${operatorCode === 'PB' ? 'PB' : displayOperator}${flightNumber}`,
    actual_runway_off: isArrival ? null : (leg?.departure?.utcActualOffShortTime ?? null),
    actual_runway_on: isArrival ? (leg?.arrival?.utcActualInShortTime ?? null) : null,
    fa_flight_id: `intelisys-${type}-${flightNumber}-${actualIso ?? expectedIso ?? Date.now()}`,
    operator: displayOperator,
    operator_icao: displayOperator,
    operator_iata: operatorCode === 'PB' ? 'PB' : displayOperator,
    flight_number: flightNumber,
    registration: leg?.tail?.identifier ?? null,
    atc_ident: null,
    inbound_fa_flight_id: null,
    codeshares: [],
    codeshares_iata: [],
    blocked: false,
    diverted: false,
    cancelled: Boolean(leg?.flightLegStatus?.cancelled),
    position_only: false,
    origin: originAirport,
    destination: destinationAirport,
    departure_delay: 0,
    arrival_delay: 0,
    filed_ete: null,
    scheduled_out: isArrival ? null : actualIso,
    estimated_out: isArrival ? null : expectedIso,
    actual_out: isArrival ? null : actualIso,
    scheduled_off: isArrival ? null : actualIso,
    estimated_off: isArrival ? null : expectedIso,
    actual_off: isArrival ? null : actualIso,
    scheduled_on: isArrival ? actualIso : null,
    estimated_on: isArrival ? expectedIso : null,
    actual_on: isArrival ? actualIso : null,
    scheduled_in: isArrival ? actualIso : null,
    estimated_in: isArrival ? expectedIso : null,
    actual_in: isArrival ? actualIso : null,
    expected: isArrival ? expectedIso : expectedIso, 
    actual: isArrival ? actualIso : actualIso,
    progress_percent: 0,
    status: deriveStatus(actualIso, expectedIso, 'On Time', Boolean(leg?.flightLegStatus?.cancelled)),
    aircraft_type: leg?.aircraftModel?.identifier ?? null,
    route_distance: leg?.distance?.length ?? null,
    filed_airspeed: null,
    filed_altitude: null,
    route: null,
    baggage_claim: null,
    seats_cabin_business: null,
    seats_cabin_coach: null,
    seats_cabin_first: null,
    gate_origin: null,
    gate_destination: null,
    terminal_origin: null,
    terminal_destination: null,
    type: 'Airline',
    airline: AIR_BOREALIS_CITIES.has(airportCity) ? 'Air Borealis' : 'PAL Airlines',
    isTomorrow: false,
    source: 'intelisys',
  };
}

function mapFlightAwareFlight(flight) { return { ...flight, source: 'flightaware' }; }

function dedupeFlights(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = [row.ident ?? '', row.scheduled_on ?? row.scheduled_off ?? '', row.origin?.code ?? '', row.destination?.code ?? ''].join('|');
    if (!seen.has(key)) seen.set(key, row);
  }
  return [...seen.values()];
}

async function fetchIntelisysStatuses(query) {
  const response = await fetch(`${INTELISYS_BASE}/flightstatuses?${query}`);
  if (!response.ok) throw new Error(`Intelisys API error: ${response.status}`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function fetchFlightAwareData() {
  const headers = { 'x-apikey': API_KEY };
  const [arrivalsRes, departuresRes] = await Promise.all([
    fetch(`${FAWARE_BASE}/airports/${FLIGHTAWARE_AIRPORT}/flights/scheduled_arrivals`, { headers }),
    fetch(`${FAWARE_BASE}/airports/${FLIGHTAWARE_AIRPORT}/flights/scheduled_departures`, { headers }),
  ]);
  if (!arrivalsRes.ok) throw new Error(`Arrivals API error: ${arrivalsRes.status}`);
  if (!departuresRes.ok) throw new Error(`Departures API error: ${departuresRes.status}`);
  
  const [arrivalsData, departuresData] = await Promise.all([arrivalsRes.json(), departuresRes.json()]);
  const rawArrivals = arrivalsData.scheduled_arrivals ?? arrivalsData.flights ?? [];
  const rawDepartures = departuresData.scheduled_departures ?? departuresData.flights ?? [];

  const filteredArrivals = rawArrivals.filter(f => isHalifaxFlight(f, 'arrivals') && hasAllowedIdent(f));
  const filteredDepartures = rawDepartures.filter(f => isHalifaxFlight(f, 'departures') && hasAllowedIdent(f));

  return {
    arrivals: filteredArrivals.map(mapFlightAwareFlight),
    departures: filteredDepartures.map(mapFlightAwareFlight),
  };
}

function writeFlightFiles(arrivalsData, departuresData, source = 'intelisys') {
  if (source === 'flightaware') {
    fs.writeFileSync(path.join(PUBLIC_DIR, 'flightaware_arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(PUBLIC_DIR, 'flightaware_departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8');
  } else {
    fs.writeFileSync(path.join(PUBLIC_DIR, 'arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(PUBLIC_DIR, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(__dirname, 'arrivals.json'), JSON.stringify(arrivalsData, null, 2), 'utf-8');
    fs.writeFileSync(path.join(__dirname, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8');
  }
}

async function fetchAndSaveIntelisysData() {
  const dateKey = formatDateKeyInTimeZone(new Date(), TIMEZONE);
  try {
    const [intelisysArrivals, intelisysDepartures] = await Promise.all([
      fetchIntelisysStatuses(`arrivalAirport=${GOOSE_BAY_AIRPORT}&arrival=${dateKey}&${INTELISYS_FLIGHT_TYPE_FILTER}`).catch(() => []),
      fetchIntelisysStatuses(`departureAirport=${GOOSE_BAY_AIRPORT}&departure=${dateKey}&${INTELISYS_FLIGHT_TYPE_FILTER}`).catch(() => []),
    ]);

    const intelisysArrivalRows = [];
    for (const status of intelisysArrivals) {
      const flightNumber = String(status?.flightNumber ?? '').trim();
      if (!flightNumber.startsWith('9')) continue;
      for (const leg of (status?.legs ?? [])) {
        if (isIntelisysArrival(leg)) intelisysArrivalRows.push(mapIntelisysFlight(status, leg, 'arrivals')); 
      }
    }

    const intelisysDepartureRows = [];
    for (const status of intelisysDepartures) {
      const flightNumber = String(status?.flightNumber ?? '').trim();
      if (!flightNumber.startsWith('9')) continue;
      for (const leg of (status?.legs ?? [])) {
        if (isIntelisysDeparture(leg)) intelisysDepartureRows.push(mapIntelisysFlight(status, leg, 'departures'));
      }
    }

    const arrivals = dedupeFlights(intelisysArrivalRows);
    const departures = dedupeFlights(intelisysDepartureRows);

    writeFlightFiles(
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'intelisys', scheduled_arrivals: arrivals },
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'intelisys', scheduled_departures: departures },
      'intelisys'
    );
    broadcastReload();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function fetchAndSaveFlightAwareData() {
  const dateKey = formatDateKeyInTimeZone(new Date(), TIMEZONE);
  try {
    const flightAware = await fetchFlightAwareData().catch(() => ({ arrivals: [], departures: [] }));
    const arrivals = dedupeFlights(flightAware.arrivals);
    const departures = dedupeFlights(flightAware.departures);

    writeFlightFiles(
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'flightaware', scheduled_arrivals: arrivals },
      { generatedAt: new Date().toISOString(), airport: GOOSE_BAY_AIRPORT, date: dateKey, source: 'flightaware', scheduled_departures: departures },
      'flightaware'
    );
    broadcastReload();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function startScheduler() {
  fetchAndSaveIntelisysData();
  fetchAndSaveFlightAwareData();
  setInterval(fetchAndSaveIntelisysData, INTELISYS_INTERVAL_MS);
  setInterval(fetchAndSaveFlightAwareData, FLIGHTAWARE_INTERVAL_MS);
}

app.post('/api/refresh', async (req, res) => {
  try {
    await Promise.all([fetchAndSaveIntelisysData(), fetchAndSaveFlightAwareData()]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/admin/state', (req, res) => { res.json(adminData); });
app.listen(PORT, () => { startScheduler(); });