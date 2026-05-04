import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import FlightTable from './components/FlightTable';
import { fetchFlightData } from './api/flightData';
import AdminPanel from './components/AdminPanel';
import {
  fetchAdminState,
  updateDisplaySettings,
  createCustomFlight,
  updateCustomFlight,
  deleteCustomFlight,
  triggerServerRefresh,
} from './api/admin';

const VIEW_INTERVAL_MS = 20_000;

const DEFAULT_SETTINGS = {
  showApiFlights: true,
  showCustomFlights: true,
  maxRowsPerTable: 20,
};

const EMPTY_CUSTOM_FLIGHTS = {
  arrivals: [],
  departures: [],
};

function App() {
  const [arrivals, setArrivals] = useState([]);
  const [departures, setDepartures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [displaySettings, setDisplaySettings] = useState(DEFAULT_SETTINGS);
  const [customFlights, setCustomFlights] = useState(EMPTY_CUSTOM_FLIGHTS);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminMessage, setAdminMessage] = useState('');

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

  const loadAdminState = useCallback(async () => {
    try {
      const state = await fetchAdminState();
      setDisplaySettings(state.displaySettings ?? DEFAULT_SETTINGS);
      setCustomFlights(state.customFlights ?? EMPTY_CUSTOM_FLIGHTS);
    } catch (err) {
      console.error('Failed to load admin state:', err);
      setAdminMessage('Unable to load admin settings.');
    }
  }, []);

  const refreshFromServer = useCallback(async () => {
    setIsRefreshing(true);
    setAdminMessage('Refreshing from API...');
    try {
      const result = await triggerServerRefresh();
      await Promise.all([loadFlights(), loadAdminState()]);

      if (result.success) {
        setAdminMessage('Refresh complete. Flight data synced.');
      } else if (result.fallback) {
        setAdminMessage('API unavailable. Loaded cached flight data instead.');
      } else {
        setAdminMessage(`Refresh failed: ${result.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Server refresh failed:', err);
      setAdminMessage(err.message || 'Refresh failed.');
    } finally {
      setIsRefreshing(false);
    }
  }, [loadAdminState, loadFlights]);

  // Initial data load
  useEffect(() => {
    loadFlights();
    loadAdminState();
  }, [loadAdminState, loadFlights]);

  // ── SSE listener — server pushes reload after every API fetch ────────────
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('reload', () => {
      console.log('🔄 SSE reload received — refreshing flights…');
      Promise.all([loadFlights(), loadAdminState()]);
    });
    es.onerror = () => console.warn('⚠️ SSE connection lost — auto-reconnecting…');

    // ── Polling fallback — force re-fetch every 1 minute ─────────────────────
    // Ensures the table stays fresh even if the SSE connection drops
    const pollInterval = setInterval(() => {
      console.log('🔁 1-min poll — refreshing flights…');
      loadFlights();
      loadAdminState();
    }, 60_000);

    return () => {
      es.close();
      clearInterval(pollInterval);
    };
  }, [loadAdminState, loadFlights]);

  useEffect(() => {
    if (!adminMessage) return undefined;
    const timer = setTimeout(() => setAdminMessage(''), 5000);
    return () => clearTimeout(timer);
  }, [adminMessage]);

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

  const mergeFlights = (type) => {
    const apiFlights = type === 'arrivals' ? arrivals : departures;
    const manualFlights = customFlights[type] || [];

    const merged = [
      ...(displaySettings.showCustomFlights ? manualFlights : []),
      ...(displaySettings.showApiFlights ? apiFlights : []),
    ];

    return merged.slice(0, displaySettings.maxRowsPerTable || 20);
  };

  const handleSaveSettings = async (settings) => {
    try {
      const updated = await updateDisplaySettings(settings);
      setDisplaySettings(updated);
      setAdminMessage('Display settings saved.');
    } catch (err) {
      setAdminMessage(err.message || 'Failed to save settings.');
    }
  };

  const handleCreateFlight = async (type, payload) => {
    try {
      await createCustomFlight(type, payload);
      await loadAdminState();
      setAdminMessage('Custom flight created.');
    } catch (err) {
      setAdminMessage(err.message || 'Failed to create custom flight.');
    }
  };

  const handleUpdateFlight = async (type, id, payload) => {
    try {
      await updateCustomFlight(type, id, payload);
      await loadAdminState();
      setAdminMessage('Custom flight updated.');
    } catch (err) {
      setAdminMessage(err.message || 'Failed to update custom flight.');
    }
  };

  const handleDeleteFlight = async (type, id) => {
    try {
      await deleteCustomFlight(type, id);
      await loadAdminState();
      setAdminMessage('Custom flight deleted.');
    } catch (err) {
      setAdminMessage(err.message || 'Failed to delete custom flight.');
    }
  };

  return (
    <div className="app">
      <Header
        lastUpdated={lastUpdated}
        onRefresh={refreshFromServer}
        isRefreshing={isRefreshing}
        onOpenAdmin={() => setAdminOpen(true)}
      />

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
            <FlightTable title="Arrivals" flights={mergeFlights('arrivals')} type="arrivals" />
          ) : (
            <FlightTable title="Departures" flights={mergeFlights('departures')} type="departures" />
          )}
        </div>
      </main>

      <AdminPanel
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        settings={displaySettings}
        customFlights={customFlights}
        onSaveSettings={handleSaveSettings}
        onCreateFlight={handleCreateFlight}
        onUpdateFlight={handleUpdateFlight}
        onDeleteFlight={handleDeleteFlight}
        onRefresh={refreshFromServer}
        isRefreshing={isRefreshing}
        actionMessage={adminMessage}
      />

      <button onClick={toggleFullScreen} className="fullscreen-btn" title="Toggle Fullscreen">
        ⛶
      </button>
    </div>
  );
}

export default App;


