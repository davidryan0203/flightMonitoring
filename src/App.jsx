import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import FlightTable from './components/FlightTable';
import { fetchFlightData } from './api/flightData';

const VIEW_INTERVAL_MS = 20_000;

function App() {
  const [arrivals, setArrivals]       = useState([]);
  const [departures, setDepartures]   = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [activeView, setActiveView] = useState('arrivals');
  const [visible, setVisible] = useState(true);

  const loadFlights = useCallback(async () => {
    try {
      setError(null);
      const data = await fetchFlightData();
      setArrivals(data.arrivals);
      setDepartures(data.departures);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch flight data:', err);
      setError('Unable to load flight data.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial data load
  useEffect(() => {
    loadFlights();
  }, [loadFlights]);

  // ── SSE listener — server pushes reload after every API fetch ────────────
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('reload', () => {
      console.log('🔄 SSE reload received — refreshing flights…');
      loadFlights();
    });
    es.onerror = () => console.warn('⚠️ SSE connection lost — auto-reconnecting…');

    // ── Polling fallback — force re-fetch every 1 minute ─────────────────────
    // Ensures the table stays fresh even if the SSE connection drops
    const pollInterval = setInterval(() => {
      console.log('🔁 1-min poll — refreshing flights…');
      loadFlights();
    }, 60_000);

    return () => {
      es.close();
      clearInterval(pollInterval);
    };
  }, [loadFlights]);

  // Rotate Arrivals <-> Departures every 20s
  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setActiveView((prev) => (prev === 'arrivals' ? 'departures' : 'arrivals'));
        setVisible(true);
      }, 300);
    }, VIEW_INTERVAL_MS);

    return () => clearInterval(id);
  }, []);

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div className="app">
      <Header lastUpdated={lastUpdated} onRefresh={loadFlights} />

      {loading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <p>Loading flight data…</p>
        </div>
      )}

      {error && !loading && (
        <div className="error-banner">{error}</div>
      )}

      <main className="single-table-view">
        <div className={`slide-view ${visible ? 'fade-in' : 'fade-out'}`}>
          {activeView === 'arrivals' ? (
            <FlightTable title="Arrivals" flights={arrivals} type="arrivals" />
          ) : (
            <FlightTable title="Departures" flights={departures} type="departures" />
          )}
        </div>
      </main>

      <button onClick={toggleFullScreen} className="fullscreen-btn" title="Toggle Fullscreen">
        ⛶
      </button>
    </div>
  );
}

export default App;


