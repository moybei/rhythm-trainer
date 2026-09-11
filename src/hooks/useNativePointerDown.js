import { useEffect, useRef } from 'react'

// No human can deliberately land two separate taps faster than this — a
// gap smaller than it is touchscreen "chatter": a single hard, fast
// contact physically bouncing on the glass and getting sensed by the
// digitizer as two separate touch-down events a few milliseconds apart
// (the same phenomenon as mechanical switch bounce). Confirmed via a raw
// touch-timing diagnostic on a real device: genuine 0ms gaps between
// reported pointerdown events during fast tapping, which is physically
// impossible as two intentional taps.
const CHATTER_DEBOUNCE_MS = 25

// Attaches a raw native 'pointerdown' listener directly to the given ref's
// element, bypassing React's synthetic event system entirely — same
// reasoning as TapArea's delegated tap listener: keyboard input (already a
// raw window 'keydown' listener, outside React) felt instant and evenly
// spaced on a phone; the identical interaction through React's synthetic
// onPointerDown did not, even for physically even taps. Used for the single
// TAP buttons in the Calibration and Tap Tempo modals, where precise,
// low-jitter timing matters just as much as it does for the main pads.
export function useNativePointerDown(ref, onPointerDown) {
  const handlerRef = useRef(onPointerDown)
  useEffect(() => {
    handlerRef.current = onPointerDown
  })

  const lastAcceptedRef = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return // ignore right/middle click
      e.preventDefault() // stop the delayed compatibility mouse/click events from also firing this
      const last = lastAcceptedRef.current
      if (last != null && e.timeStamp - last < CHATTER_DEBOUNCE_MS) return // touchscreen chatter, not a second tap
      lastAcceptedRef.current = e.timeStamp
      handlerRef.current(e)
    }
    el.addEventListener('pointerdown', handler, { passive: false })
    return () => el.removeEventListener('pointerdown', handler)
  }, [ref])
}
