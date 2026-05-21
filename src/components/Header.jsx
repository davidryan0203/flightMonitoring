import React, { useState, useEffect } from 'react';
import gooseBayLogo from '../img/goose-bay-airport.jpeg';

const AIRLINES = ['Air Canada', 'PAL Airlines', 'Air Borealis'];

const Header = ({ lastUpdated, onRefresh, isRefreshing, onOpenAdmin }) => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = time.toLocaleDateString('en-CA', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  return (
    <header className="kiosk-header">
      <div className="header-left">
        <img src={gooseBayLogo} alt="Goose Bay Airport" className="airport-logo" />
        <div className="header-titles">
          <h1>Flight Information Display</h1>
          <p className="airlines-label">{AIRLINES.join(' · ')}</p>
        </div>
      </div>
      <div className="header-right">
        <div className="date-time">
          <div className="clock">{time.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
          <div className="date">{dateStr}</div>
        </div>
        {/* <div className="update-info">
          {lastUpdated && (
            <span className="last-updated">
              Updated: {lastUpdated.toLocaleTimeString('en-CA', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className="refresh-btn" onClick={onRefresh} title="Refresh now" disabled={isRefreshing}>
            {isRefreshing ? '...' : '↻'}
          </button>
          <button className="admin-btn" onClick={onOpenAdmin} title="Open admin controls">
            Admin
          </button>
        </div> */}
      </div>
    </header>
  );
};

export default Header;
