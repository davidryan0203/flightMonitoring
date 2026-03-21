import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Forward all /api/* requests to the Express server (port 3001)
      // This includes /api/events (SSE) and /api/refresh (manual trigger)
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Uncomment when live API quota resets:
      // '/aeroapi': {
      //   target: 'https://aeroapi.flightaware.com',
      //   changeOrigin: true,
      // },
    },
  },
})
