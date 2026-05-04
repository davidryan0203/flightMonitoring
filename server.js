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
const AIRPORT      = 'CYYR';
const TIMEZONE     = 'America/St_Johns';
const PORT         = 3001;

// Public folder — JSON files are written here so the browser can fetch them
const PUBLIC_DIR   = path.join(__dirname, 'public');

const ADMIN_DATA_PATH = path.join(__dirname, 'admin_data.json');

const DEFAULT_ADMIN_DATA = {
  displaySettings: {
    showApiFlights: true,
    showCustomFlights: true,
    maxRowsPerTable: 20,
  },
  customFlights: {
    arrivals: [],
    departures: [],
  },
};

// ─── SSE Client Registry ──────────────────────────────────────────────────────
// Keeps a Set of active SSE response objects. When new data is ready, we
// broadcast a "reload" event to every connected browser tab.
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
      displaySettings: {
        ...DEFAULT_ADMIN_DATA.displaySettings,
        ...(raw.displaySettings ?? {}),
      },
      customFlights: {
        arrivals: Array.isArray(raw.customFlights?.arrivals) ? raw.customFlights.arrivals : [],
        departures: Array.isArray(raw.customFlights?.departures) ? raw.customFlights.departures : [],
      },
    };
  } catch (err) {
    console.error('❌ Failed to load admin_data.json:', err.message);
    return structuredClone(DEFAULT_ADMIN_DATA);
  }
}

function saveAdminData(data) {
  fs.writeFileSync(ADMIN_DATA_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

let adminData = loadAdminData();

function sanitizeCustomFlight(payload = {}, type) {
  const base = {
    id: payload.id ?? `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    flight: String(payload.flight ?? '').trim(),
    airline: String(payload.airline ?? '').trim(),
    actual: String(payload.actual ?? '').trim(),
    status: String(payload.status ?? 'Scheduled').trim() || 'Scheduled',
    isTomorrow: Boolean(payload.isTomorrow),
  };

  if (type === 'arrivals') {
    return {
      ...base,
      from: String(payload.from ?? '').trim(),
      expected: String(payload.expected ?? '').trim(),
    };
  }

  return {
    ...base,
    to: String(payload.to ?? '').trim(),
    schedule: String(payload.schedule ?? '').trim(),
  };
}

function validateCustomFlight(flight, type) {
  if (!flight.flight) return 'Flight number is required.';
  if (!flight.airline) return 'Airline is required.';
  if (type === 'arrivals') {
    if (!flight.from) return 'Origin is required for arrivals.';
    if (!flight.expected) return 'Expected time is required for arrivals.';
  } else {
    if (!flight.to) return 'Destination is required for departures.';
    if (!flight.schedule) return 'Schedule time is required for departures.';
  }
  return null;
}

// ─── SSE Endpoint ─────────────────────────────────────────────────────────────
// Browser tabs connect here once on load and stay connected.
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Send a heartbeat every 30 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  sseClients.add(res);
  console.log(`✅ SSE client connected (total: ${sseClients.size})`);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
    console.log(`❌ SSE client disconnected (total: ${sseClients.size})`);
  });
});

// ─── API Fetch & Write ────────────────────────────────────────────────────────
/**
 * Fetches fresh arrivals + departures from FlightAware, writes the raw JSON
 * to public/arrivals.json and public/departures.json, then broadcasts a
 * reload event so every connected browser tab refreshes its data.
 */
async function fetchAndSaveFlightData() {
  console.log(`\n🔄 [${new Date().toISOString()}] Fetching fresh flight data from FlightAware…`);
  try {
    const headers = { 'x-apikey': API_KEY };
    const [arrivalsRes, departuresRes] = await Promise.all([
      fetch(`${FAWARE_BASE}/airports/${AIRPORT}/flights/scheduled_arrivals`,  { headers }),
      fetch(`${FAWARE_BASE}/airports/${AIRPORT}/flights/scheduled_departures`, { headers }),
    ]);

    if (!arrivalsRes.ok)   throw new Error(`Arrivals API error: ${arrivalsRes.status}`);
    if (!departuresRes.ok) throw new Error(`Departures API error: ${departuresRes.status}`);

    const [arrivalsData, departuresData] = await Promise.all([
      arrivalsRes.json(),
      departuresRes.json(),
    ]);

    // Write raw API responses to public/ so the browser can fetch them directly
    fs.writeFileSync(path.join(PUBLIC_DIR, 'arrivals.json'),   JSON.stringify(arrivalsData,   null, 2), 'utf-8');
    fs.writeFileSync(path.join(PUBLIC_DIR, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8');

    // Also keep root-level copies for server-side reads / debugging
    fs.writeFileSync(path.join(__dirname, 'arrivals.json'),   JSON.stringify(arrivalsData,   null, 2), 'utf-8');
    fs.writeFileSync(path.join(__dirname, 'departures.json'), JSON.stringify(departuresData, null, 2), 'utf-8');

    console.log(`✅ Flight data saved. Arrivals: ${(arrivalsData.scheduled_arrivals ?? []).length} | Departures: ${(departuresData.scheduled_departures ?? []).length}`);

    // Tell all open browser tabs to re-fetch the new JSON files
    broadcastReload();

    return {
      success: true,
      arrivals: (arrivalsData.scheduled_arrivals ?? []).length,
      departures: (departuresData.scheduled_departures ?? []).length,
    };
  } catch (err) {
    console.error('❌ fetchAndSaveFlightData error:', err.message);

    // ── Fallback: serve existing local JSON if the API call fails ────────────
    // This keeps the display running on quota errors or network issues.
    const arrivalsPath   = path.join(PUBLIC_DIR, 'arrivals.json');
    const departuresPath = path.join(PUBLIC_DIR, 'departures.json');

    if (fs.existsSync(arrivalsPath) && fs.existsSync(departuresPath)) {
      console.warn('⚠️  Using cached local JSON files (API unavailable).');
      broadcastReload(); // browsers will re-fetch the existing public/ files
      return { success: false, fallback: true, error: err.message };
    } else {
      console.error('❌ No cached JSON files found in public/ — display will remain empty.');
      return { success: false, fallback: false, error: err.message };
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
// Fetches fresh data immediately on startup, then every day at 03:00 local time.
// After each successful fetch, all connected browser tabs are notified via SSE
// and silently re-fetch the updated JSON files.
function msUntilNext3AM() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function startScheduler() {
  console.log('⏰ Scheduler started — daily fetch at 3:00 AM (server local time)');
  fetchAndSaveFlightData(); // run immediately on startup

  const scheduleNextRun = () => {
    const waitMs = msUntilNext3AM();
    const nextRun = new Date(Date.now() + waitMs);
    console.log(`🗓️  Next scheduled fetch at ${nextRun.toLocaleString('en-CA')}`);

    setTimeout(async () => {
      await fetchAndSaveFlightData();
      scheduleNextRun();
    }, waitMs);
  };

  scheduleNextRun();
}

// ─── Manual Trigger Endpoint (admin/testing) ──────────────────────────────────
// Hit POST /api/refresh to trigger an immediate data fetch without waiting for 3 AM.
app.post('/api/refresh', async (req, res) => {
  console.log('🔁 Manual refresh triggered via POST /api/refresh');
  const result = await fetchAndSaveFlightData();
  res.json({ message: 'Refresh complete', ...result });
});

app.get('/api/admin/state', (req, res) => {
  res.json(adminData);
});

app.put('/api/admin/display-settings', (req, res) => {
  const payload = req.body ?? {};
  const maxRowsRaw = Number(payload.maxRowsPerTable);
  adminData.displaySettings = {
    showApiFlights: payload.showApiFlights !== undefined ? Boolean(payload.showApiFlights) : adminData.displaySettings.showApiFlights,
    showCustomFlights: payload.showCustomFlights !== undefined ? Boolean(payload.showCustomFlights) : adminData.displaySettings.showCustomFlights,
    maxRowsPerTable: Number.isFinite(maxRowsRaw) ? Math.max(1, Math.min(100, Math.floor(maxRowsRaw))) : adminData.displaySettings.maxRowsPerTable,
  };
  saveAdminData(adminData);
  broadcastReload();
  res.json(adminData.displaySettings);
});

app.post('/api/admin/flights/:type', (req, res) => {
  const type = req.params.type;
  if (type !== 'arrivals' && type !== 'departures') {
    return res.status(400).json({ error: 'Type must be arrivals or departures.' });
  }

  const flight = sanitizeCustomFlight(req.body, type);
  const error = validateCustomFlight(flight, type);
  if (error) {
    return res.status(400).json({ error });
  }

  adminData.customFlights[type].push(flight);
  saveAdminData(adminData);
  broadcastReload();
  return res.status(201).json(flight);
});

app.put('/api/admin/flights/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (type !== 'arrivals' && type !== 'departures') {
    return res.status(400).json({ error: 'Type must be arrivals or departures.' });
  }

  const index = adminData.customFlights[type].findIndex((f) => f.id === id);
  if (index === -1) {
    return res.status(404).json({ error: 'Flight not found.' });
  }

  const updated = sanitizeCustomFlight({ ...adminData.customFlights[type][index], ...req.body, id }, type);
  const error = validateCustomFlight(updated, type);
  if (error) {
    return res.status(400).json({ error });
  }

  adminData.customFlights[type][index] = updated;
  saveAdminData(adminData);
  broadcastReload();
  return res.json(updated);
});

app.delete('/api/admin/flights/:type/:id', (req, res) => {
  const { type, id } = req.params;
  if (type !== 'arrivals' && type !== 'departures') {
    return res.status(400).json({ error: 'Type must be arrivals or departures.' });
  }

  const before = adminData.customFlights[type].length;
  adminData.customFlights[type] = adminData.customFlights[type].filter((f) => f.id !== id);

  if (adminData.customFlights[type].length === before) {
    return res.status(404).json({ error: 'Flight not found.' });
  }

  saveAdminData(adminData);
  broadcastReload();
  return res.status(204).send();
});

// ─── Static File Server ───────────────────────────────────────────────────────
// Serves the Vite production build (npm run build → dist/) AND the public/ JSON files.
// In development, Vite's own dev server handles static files — this is for production.
const DIST_DIR = path.join(__dirname, 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
  app.get('/{*path}', (req, res) => res.sendFile(path.join(DIST_DIR, 'index.html')));
  console.log(`📁 Serving built app from dist/`);
} else {
  app.use('/public', express.static(PUBLIC_DIR));
  console.log(`⚠️  No dist/ folder found — run "npm run build" for production. Dev mode: use "npm run dev" separately.`);
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🛫  Flight Monitor Server → http://localhost:${PORT}`);
  console.log(`📡  Airport: ${AIRPORT} | Timezone: ${TIMEZONE}`);
  console.log(`✈️   Airlines: PAL Airlines (PB/PVL) · Air Borealis · Air Canada (ACA/AC)\n`);
  startScheduler();
});
