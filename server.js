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

// How often to fetch fresh flight data from the API (every 30 minutes)
const FETCH_INTERVAL_MS = 30 * 60 * 1000;

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const ALLOWED_OPERATORS   = new Set(['PVL', 'PB', 'ACA', 'AC']);
const AIR_BOREALIS_CITIES = new Set(['Nain', 'Postville', 'Rigolet', 'Makkovik', 'Natuashish', 'Hopedale']);
const EXCLUDED_ORIGIN     = 'CVB2';

function formatApiDatetime(isoString) {
  if (!isoString) return '';
  try {
    return new Date(isoString).toLocaleTimeString('en-CA', {
      timeZone: TIMEZONE, hour: 'numeric', minute: '2-digit', hour12: true,
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

function resolveAirline(city) {
  if (city === 'Halifax') return 'Air Canada';
  if (AIR_BOREALIS_CITIES.has(city)) return 'Air Borealis';
  return 'PAL Airlines';
}

function isAllowedOperator(flight) {
  return (
    ALLOWED_OPERATORS.has(flight.operator      ?? '') ||
    ALLOWED_OPERATORS.has(flight.operator_icao ?? '') ||
    ALLOWED_OPERATORS.has(flight.operator_iata ?? '')
  );
}

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
  } catch (err) {
    console.error('❌ fetchAndSaveFlightData error:', err.message);

    // ── Fallback: serve existing local JSON if the API call fails ────────────
    // This keeps the display running on quota errors or network issues.
    const arrivalsPath   = path.join(PUBLIC_DIR, 'arrivals.json');
    const departuresPath = path.join(PUBLIC_DIR, 'departures.json');

    if (fs.existsSync(arrivalsPath) && fs.existsSync(departuresPath)) {
      console.warn('⚠️  Using cached local JSON files (API unavailable).');
      broadcastReload(); // browsers will re-fetch the existing public/ files
    } else {
      console.error('❌ No cached JSON files found in public/ — display will remain empty.');
    }
  }
}

// ─── Scheduler ───────────────────────────────────────────────────────────────
// Fetches fresh data immediately on startup, then repeats every 30 minutes.
// After each successful fetch, all connected browser tabs are notified via SSE
// and silently re-fetch the updated JSON files.
function startScheduler() {
  console.log(`⏰ Scheduler started — fetching every ${FETCH_INTERVAL_MS / 60000} minutes`);
  fetchAndSaveFlightData(); // run immediately on startup
  setInterval(fetchAndSaveFlightData, FETCH_INTERVAL_MS);
}

// ─── Manual Trigger Endpoint (admin/testing) ──────────────────────────────────
// Hit POST /api/refresh to trigger an immediate data fetch without waiting for 2 AM.
app.post('/api/refresh', async (req, res) => {
  console.log('🔁 Manual refresh triggered via POST /api/refresh');
  res.json({ message: 'Refresh started' });
  await fetchAndSaveFlightData();
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
