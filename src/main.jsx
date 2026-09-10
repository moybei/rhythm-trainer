import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './styles.css'
import App from './App.jsx'

// autoUpdate: a new deploy's service worker takes over silently on the
// next page load — no "update available" prompt to wire up, matching
// "auto update publish when push".
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
