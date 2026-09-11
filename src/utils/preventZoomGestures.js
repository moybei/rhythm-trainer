// The viewport meta's maximum-scale=1.0/user-scalable=no (index.html) and
// touch-action CSS (styles.css) are the *first* line of defense against
// zooming, but neither is fully reliable on iOS: Safari has deliberately
// ignored user-scalable=no in regular (non-installed) browser tabs since
// iOS 10, specifically so zoom stays available for accessibility — so a
// page simply cannot opt out of pinch/double-tap zoom through the viewport
// meta alone there. This adds a JS-level backstop that works regardless:
//   - double-tap-zoom: intercepted by watching for two touchend events in
//     quick succession and preventing the second one's default action,
//     which is what the browser would otherwise read as "zoom in here".
//   - pinch-zoom: intercepted via Safari's proprietary gesturestart/
//     gesturechange events (fired only by WebKit; harmless no-ops
//     elsewhere), which is the standard way to suppress that gesture
//     independent of touch-action support.
// Call once from the app root; returns a cleanup function.
export function preventZoomGestures() {
  let lastTouchEnd = 0
  const onTouchEnd = (e) => {
    const now = Date.now()
    if (now - lastTouchEnd <= 350) e.preventDefault()
    lastTouchEnd = now
  }
  const onGesture = (e) => e.preventDefault()

  document.addEventListener('touchend', onTouchEnd, { passive: false })
  document.addEventListener('gesturestart', onGesture)
  document.addEventListener('gesturechange', onGesture)

  return () => {
    document.removeEventListener('touchend', onTouchEnd)
    document.removeEventListener('gesturestart', onGesture)
    document.removeEventListener('gesturechange', onGesture)
  }
}
