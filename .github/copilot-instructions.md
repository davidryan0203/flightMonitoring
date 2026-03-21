# Flight Monitoring App

## Project Overview
A full-screen kiosk-style React + Vite flight information display board.
Shows **Arrivals** and **Departures** for **Air Canada**, **PAL Airlines**, and **Air Borealis**.
Data is fetched live from **FlightAware AeroAPI** every 15 minutes via a local Express proxy server.

## Tech Stack
- **Frontend**: React 19, Vite
- **Backend proxy**: Node.js + Express (port 3001)
- **API**: FlightAware AeroAPI (`https://aeroapi.flightaware.com/aeroapi/`)

## Running the App
```bash
npm run start       # starts both proxy server (3001) and Vite dev server (5173)
npm run server      # proxy server only
npm run dev         # Vite frontend only
```

## Key Files
| File | Purpose |
|------|---------|
| `server.js` | Express proxy — calls FlightAware API, saves JSON snapshot once |
| `src/api/flightData.js` | Fetches from local proxy |
| `src/App.jsx` | Root component, 15-min refresh logic |
| `src/components/Header.jsx` | Clock, date, last-updated, refresh button |
| `src/components/FlightTable.jsx` | Arrivals / Departures table |
| `src/index.css` | Dark kiosk theme |
| `flight_data_snapshot.json` | Auto-generated on first API call (for reference) |

## API Key
Stored directly in `server.js`. Replace `cUMXuU3rMbSQfiAGVIMa4qMHbJGXN9Z7` with a new key if it expires.

## Notes
- Flights are filtered to **today's date** (00:00–23:59 local).
- Results are **sorted by scheduled time** (ascending).
- A raw JSON snapshot is saved to `flight_data_snapshot.json` once per server run.
