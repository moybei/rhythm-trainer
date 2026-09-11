import { useEffect, useRef } from 'react'

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

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return // ignore right/middle click
      e.preventDefault() // stop the delayed compatibility mouse/click events from also firing this
      handlerRef.current(e)
    }
    el.addEventListener('pointerdown', handler, { passive: false })
    return () => el.removeEventListener('pointerdown', handler)
  }, [ref])
}
