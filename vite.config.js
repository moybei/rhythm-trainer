import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://moybei.github.io/rhythm-trainer/ — every asset URL
  // needs this subpath prefix, or GitHub Pages 404s on load.
  base: '/rhythm-trainer/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: false, // registered manually in src/main.jsx
      includeAssets: ['icons/icon-192.png', 'icons/icon-512.png'],
      manifest: {
        name: 'Rhythm Trainer',
        short_name: 'Rhythm Trainer',
        description: 'Metronome-driven drum rudiment practice trainer with real-time judgement.',
        start_url: '/rhythm-trainer/',
        scope: '/rhythm-trainer/',
        display: 'standalone',
        orientation: 'landscape',
        background_color: '#15161a',
        theme_color: '#15161a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell + the sound assets so practice still works
        // fully offline once the PWA has been opened once.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2,wav,mp3,ogg}'],
        runtimeCaching: [
          {
            // Google Fonts stylesheet + font files — cache so the app's
            // typeface still loads offline after the first visit.
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
