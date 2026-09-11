import { useEffect, useRef } from 'react'
import { createChatterFilter } from '../utils/chatterFilter.js'

// Attaches raw native listeners directly to the given ref's element,
// bypassing React's synthetic event system entirely — same reasoning as
// TapArea's delegated tap listener: keyboard input (already a raw window
// 'keydown' listener, outside React) felt instant and evenly spaced on a
// phone; the identical interaction through React's synthetic onPointerDown
// did not, even for physically even taps.
//
// Touch specifically uses 'touchstart', not 'pointerdown': Safari only
// gained full Pointer Events support in iOS 13 (2019), well after touch
// events (WebKit's original, native-first touch API) — Pointer Events
// there effectively translate on top of the same underlying touch
// pipeline, adding a dispatch step 'touchstart' skips. 'pointerdown' is
// kept for mouse/pen (touch explicitly ignored there, so a real touch is
// never handled twice). Used for the single TAP buttons in the
// Calibration and Tap Tempo modals, where precise, low-jitter timing
// matters just as much as it does for the main pads.
export function useNativePointerDown(ref, onPointerDown) {
  const handlerRef = useRef(onPointerDown)
  useEffect(() => {
    handlerRef.current = onPointerDown
  })

  // Single-button, so one filter key is enough. See
  // utils/chatterFilter.js for why a timestamp gap alone is not enough to
  // identify a bounce on iOS.
  const acceptChatterRef = useRef(null)
  if (acceptChatterRef.current === null) acceptChatterRef.current = createChatterFilter()

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const accept = (e) => {
      if (!acceptChatterRef.current('tap', e.timeStamp)) return // touchscreen chatter, not a second tap
      handlerRef.current(e)
    }

    const onTouchStart = (e) => {
      e.preventDefault() // stop the delayed compatibility mouse/click events from also firing this
      accept(e)
    }

    const onNativePointerDown = (e) => {
      if (e.pointerType === 'touch') return // touch is handled by 'touchstart' above instead
      if (e.pointerType === 'mouse' && e.button !== 0) return // ignore right/middle click
      e.preventDefault()
      accept(e)
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('pointerdown', onNativePointerDown, { passive: false })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('pointerdown', onNativePointerDown)
    }
  }, [ref])
}
