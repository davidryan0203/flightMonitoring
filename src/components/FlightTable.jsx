import React from 'react';
import airBorealisLogo from '../img/air-borealis.webp';
import airCanadaLogo   from '../img/air-canada.webp';
import palAirlineLogo  from '../img/pal-airline.webp';

const statusClass = (status = '') =>
  status.toLowerCase().replace(/[\s/]+/g, '-');

const formatTimeDisplay = (value) =>
  String(value || '\u2014')
    .trim()
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, (_, period) => `${period.toUpperCase()}M`)
    .replace(/\b(AM|PM)\.\s*$/i, '$1');

// Filter out flights where actual time is more than 2 hours in the past
const isFlightExpired = (flight) => {
  // Use rawTime field which contains the actual ISO timestamp
  if (!flight.rawTime) return false;
  try {
    const actualTime = new Date(flight.rawTime);
    // Validate that the date parsed successfully
    if (isNaN(actualTime.getTime())) return false;
    const now = Date.now();
    const twoHoursMs = 4 * 60 * 60 * 1000;
    return (now - actualTime) > twoHoursMs;
  } catch {
    return false;
  }
};

const AIRLINE_LOGOS = {
  'Air Canada':   airCanadaLogo,
  'PAL Airlines': palAirlineLogo,
  'Air Borealis': airBorealisLogo,
};

function AirlineBadge({ airline }) {
  const logo = AIRLINE_LOGOS[airline];
  if (logo) {
    return (
      <img
        src={logo}
        alt={airline}
        className="airline-logo"
        title={airline}
      />
    );
  }
  // Fallback for unknown carriers
  return (
    <span className="airline-badge" style={{ backgroundColor: '#2a3550', color: '#aac' }}>
      {airline || '\u2014'}
    </span>
  );
}

const FlightTable = ({ title, flights, type }) => {
  const isArrivals = type === 'arrivals';
  const icon = isArrivals ? '\uD83D\uDEEC' : '\uD83D\uDEEB';

  // Filter out flights with actual time more than 2 hours in the past
  const activeFlights = flights.filter((flight) => !isFlightExpired(flight));

  return (
    <div className="flight-table-container">
      <div className="table-title-row">
        <span className="table-icon">{icon}</span>
        <h2>{title}</h2>
        <span className="flight-count">{activeFlights.length} flights</span>
      </div>
      <div className="table-body-wrapper">
        <table className="flight-table">
          <thead>
            <tr>
              <th>Airline</th>
              <th>Flight #</th>
              <th>{isArrivals ? 'Origin' : 'Destination'}</th>
              <th>Expected</th>
              <th>Actual</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {activeFlights.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  No {title.toLowerCase()} to display for these airlines today.
                </td>
              </tr>
            ) : (
              activeFlights.map((flight, index) => (
                <tr key={flight.id ?? `${flight.flight}-${index}`}>
                  <td><AirlineBadge airline={flight.airline} /></td>
                  <td className="flight-cell">{flight.flight}</td>
                  <td>{isArrivals ? (flight.from || '\u2014') : (flight.to || '\u2014')}</td>
                  <td className="time-cell actual-time">
                    {formatTimeDisplay(flight.actual)}
                  </td>
                  <td className="time-cell">
                    <span className="time-with-badge">
                      {formatTimeDisplay(isArrivals ? flight.expected : flight.schedule)}
                      {flight.isTomorrow && <span className="day-badge"> Tomorrow</span>}
                    </span>
                  </td>
                  <td>
                    <span className={`status ${statusClass(flight.status)}`}>
                      {flight.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default FlightTable;
