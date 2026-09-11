// Forces a full reload that bypasses every layer of caching this app has —
// the service worker's precache, the browser's own Cache Storage, and a
// cache-busted navigation so even an intermediate HTTP cache can't serve a
// stale index.html. Mobile browsers (especially iOS Safari, and a PWA added
// to the home screen) often have no equivalent of a desktop hard-refresh,
// so this is the only reliable way for a phone to force-fetch the latest
// deployed build instead of whatever it had cached.
export async function hardReload() {
  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    }
  } catch {
    // Not fatal — still try to clear caches and reload below.
  }
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch {
    // Not fatal.
  }
  const url = new URL(window.location.href)
  url.searchParams.set('_r', Date.now().toString()) // defeats any HTTP-level cache for the navigation itself
  window.location.replace(url.toString())
}
