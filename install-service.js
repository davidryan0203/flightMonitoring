/**
 * install-service.js
 *
 * Registers server.js as a Windows Service named "FlightMonitorServer".
 * The service starts automatically on boot and restarts on crash.
 *
 * Run ONCE on the dedicated server machine (as Administrator):
 *   npm run install-service
 *
 * Requires: npm install node-windows (run "npm run setup-service" first)
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import process from 'process';

const require      = createRequire(import.meta.url);
const __filename   = fileURLToPath(import.meta.url);
const __dirname    = path.dirname(__filename);

const { Service }  = require('node-windows');

const svc = new Service({
  name:        'FlightMonitorServer',
  description: 'Flight Information Display — fetches FlightAware data every 15 min and serves the kiosk web app.',
  script:      path.join(__dirname, 'server.js'),

  // Pass --experimental-vm-modules so Node ESM works inside the service
  execPath: process.execPath,
  nodeOptions: [],

  env: [
    { name: 'NODE_ENV', value: 'production' },
    { name: 'PORT',     value: '3001'        },
  ],

  // Restart policy: wait 5 s, then 10 s, then 30 s between attempts
  wait:    5,
  grow:    0.5,
  maxRestarts: 10,
});

svc.on('install', () => {
  console.log('✅ Service installed successfully.');
  console.log('🚀 Starting FlightMonitorServer…');
  svc.start();
});

svc.on('start', () => {
  console.log('✅ FlightMonitorServer is now running as a Windows Service.');
  console.log('   Open http://localhost:3001 to verify.');
});

svc.on('alreadyinstalled', () => {
  console.warn('⚠️  Service is already installed. Run "npm run uninstall-service" first if you want to reinstall.');
});

svc.on('error', (err) => {
  console.error('❌ Service error:', err);
});

svc.install();
