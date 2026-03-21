/**
 * uninstall-service.js
 *
 * Stops and removes the "FlightMonitorServer" Windows Service.
 *
 * Run as Administrator:
 *   npm run uninstall-service
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require    = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const { Service } = require('node-windows');

const svc = new Service({
  name:   'FlightMonitorServer',
  script: path.join(__dirname, 'server.js'),
});

svc.on('stop', () => {
  console.log('🛑 Service stopped.');
  svc.uninstall();
});

svc.on('uninstall', () => {
  console.log('✅ FlightMonitorServer service uninstalled successfully.');
});

svc.on('notinstalled', () => {
  console.warn('⚠️  Service is not installed.');
});

svc.on('error', (err) => {
  console.error('❌ Error:', err);
});

svc.stop();
