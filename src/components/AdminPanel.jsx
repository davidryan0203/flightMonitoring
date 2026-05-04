import React, { useEffect, useMemo, useState } from 'react';

const EMPTY_FORM = {
  id: null,
  type: 'arrivals',
  flight: '',
  airline: '',
  status: 'Scheduled',
  actual: '',
  isTomorrow: false,
  from: '',
  expected: '',
  to: '',
  schedule: '',
};

function toForm(type, flight) {
  return {
    ...EMPTY_FORM,
    ...flight,
    id: flight.id,
    type,
  };
}

const AdminPanel = ({
  isOpen,
  onClose,
  settings,
  customFlights,
  onSaveSettings,
  onCreateFlight,
  onUpdateFlight,
  onDeleteFlight,
  onRefresh,
  isRefreshing,
  actionMessage,
}) => {
  const [localSettings, setLocalSettings] = useState(settings);
  const [form, setForm] = useState(EMPTY_FORM);

  useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  const allCustomFlights = useMemo(() => {
    return [
      ...(customFlights.arrivals || []).map((flight) => ({ ...flight, type: 'arrivals' })),
      ...(customFlights.departures || []).map((flight) => ({ ...flight, type: 'departures' })),
    ];
  }, [customFlights]);

  if (!isOpen) return null;

  const submitLabel = form.id ? 'Update Flight' : 'Create Flight';

  const handleSubmit = async (event) => {
    event.preventDefault();

    const payload = {
      flight: form.flight,
      airline: form.airline,
      status: form.status,
      actual: form.actual,
      isTomorrow: form.isTomorrow,
    };

    if (form.type === 'arrivals') {
      payload.from = form.from;
      payload.expected = form.expected;
    } else {
      payload.to = form.to;
      payload.schedule = form.schedule;
    }

    try {
      if (form.id) {
        await onUpdateFlight(form.type, form.id, payload);
      } else {
        await onCreateFlight(form.type, payload);
      }
      setForm((prev) => ({ ...EMPTY_FORM, type: prev.type }));
    } catch {
      // Errors are surfaced through parent actionMessage.
    }
  };

  return (
    <div className="admin-backdrop" onClick={onClose}>
      <aside className="admin-panel" onClick={(event) => event.stopPropagation()}>
        <div className="admin-panel-header">
          <h3>Admin Controls</h3>
          <button type="button" className="admin-close-btn" onClick={onClose}>Close</button>
        </div>

        <section className="admin-section">
          <h4>Display Settings</h4>
          <label>
            <input
              type="checkbox"
              checked={Boolean(localSettings.showApiFlights)}
              onChange={(event) => setLocalSettings((prev) => ({ ...prev, showApiFlights: event.target.checked }))}
            />
            Show API flights
          </label>
          <label>
            <input
              type="checkbox"
              checked={Boolean(localSettings.showCustomFlights)}
              onChange={(event) => setLocalSettings((prev) => ({ ...prev, showCustomFlights: event.target.checked }))}
            />
            Show admin-created flights
          </label>
          <label>
            Max rows per table
            <input
              type="number"
              min="1"
              max="100"
              value={localSettings.maxRowsPerTable || 20}
              onChange={(event) => setLocalSettings((prev) => ({
                ...prev,
                maxRowsPerTable: Number(event.target.value || 20),
              }))}
            />
          </label>
          <button type="button" onClick={() => onSaveSettings(localSettings)}>
            Save Display Settings
          </button>
        </section>

        <section className="admin-section">
          <h4>Sync Flight Data</h4>
          <p>Pull the latest data from the FlightAware API and update all displays.</p>
          <button type="button" onClick={onRefresh} disabled={isRefreshing}>
            {isRefreshing ? 'Refreshing...' : 'Refresh From API'}
          </button>
        </section>

        <section className="admin-section">
          <h4>{form.id ? 'Edit Flight' : 'Create Flight'}</h4>
          <form className="admin-form" onSubmit={handleSubmit}>
            <label>
              Type
              <select
                value={form.type}
                onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value }))}
              >
                <option value="arrivals">Arrivals</option>
                <option value="departures">Departures</option>
              </select>
            </label>
            <label>
              Flight #
              <input
                value={form.flight}
                onChange={(event) => setForm((prev) => ({ ...prev, flight: event.target.value }))}
                required
              />
            </label>
            <label>
              Airline
              <input
                value={form.airline}
                onChange={(event) => setForm((prev) => ({ ...prev, airline: event.target.value }))}
                required
              />
            </label>
            {form.type === 'arrivals' ? (
              <>
                <label>
                  Origin
                  <input
                    value={form.from}
                    onChange={(event) => setForm((prev) => ({ ...prev, from: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Expected Time
                  <input
                    value={form.expected}
                    onChange={(event) => setForm((prev) => ({ ...prev, expected: event.target.value }))}
                    placeholder="e.g. 08:30 AM"
                    required
                  />
                </label>
              </>
            ) : (
              <>
                <label>
                  Destination
                  <input
                    value={form.to}
                    onChange={(event) => setForm((prev) => ({ ...prev, to: event.target.value }))}
                    required
                  />
                </label>
                <label>
                  Schedule Time
                  <input
                    value={form.schedule}
                    onChange={(event) => setForm((prev) => ({ ...prev, schedule: event.target.value }))}
                    placeholder="e.g. 08:30 AM"
                    required
                  />
                </label>
              </>
            )}
            <label>
              Actual Time
              <input
                value={form.actual}
                onChange={(event) => setForm((prev) => ({ ...prev, actual: event.target.value }))}
                placeholder="e.g. 08:40 AM"
              />
            </label>
            <label>
              Status
              <input
                value={form.status}
                onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value }))}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={Boolean(form.isTomorrow)}
                onChange={(event) => setForm((prev) => ({ ...prev, isTomorrow: event.target.checked }))}
              />
              Mark as tomorrow
            </label>
            <div className="admin-form-actions">
              <button type="submit">{submitLabel}</button>
              {form.id && (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setForm(EMPTY_FORM)}
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        </section>

        <section className="admin-section">
          <h4>Custom Flights</h4>
          {allCustomFlights.length === 0 ? (
            <p>No admin-created flights yet.</p>
          ) : (
            <ul className="admin-flight-list">
              {allCustomFlights.map((flight) => (
                <li key={flight.id}>
                  <div>
                    <strong>{flight.flight}</strong> ({flight.type}) - {flight.airline}
                  </div>
                  <div className="admin-list-meta">
                    {flight.type === 'arrivals'
                      ? `From ${flight.from} at ${flight.expected}`
                      : `To ${flight.to} at ${flight.schedule}`}
                  </div>
                  <div className="admin-list-actions">
                    <button type="button" onClick={() => setForm(toForm(flight.type, flight))}>Edit</button>
                    <button
                      type="button"
                      className="danger-btn"
                      onClick={async () => {
                        try {
                          await onDeleteFlight(flight.type, flight.id);
                        } catch {
                          // Errors are surfaced through parent actionMessage.
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {actionMessage && <p className="admin-action-message">{actionMessage}</p>}
      </aside>
    </div>
  );
};

export default AdminPanel;
