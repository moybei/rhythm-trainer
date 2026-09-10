import { useLayoutEffect, useRef } from 'react'

const BASE_FONT_SIZE = 18 // px — matches .display-note's untouched default
const MIN_FONT_SIZE = 9

// Shrinks the note glyphs (via the --note-font-size CSS variable) just
// enough that the widest row of the pattern fits the screen instead of
// overflowing past its edge — important on narrow phones, where a 16-beat
// row at the full 18px can run well past the viewport. Re-measures on
// resize and whenever the pattern's shape changes (a different pattern,
// swapped hands, more/fewer rows).
export function useFitFontSize(containerRef, deps) {
  const rafRef = useRef(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const fit = () => {
      el.style.setProperty('--note-font-size', `${BASE_FONT_SIZE}px`)
      const available = el.clientWidth
      if (available <= 0) return
      let natural = el.scrollWidth
      if (natural <= available) {
        el.style.setProperty('--note-font-size', `${BASE_FONT_SIZE}px`)
        return
      }
      let size = Math.max(MIN_FONT_SIZE, BASE_FONT_SIZE * (available / natural))
      el.style.setProperty('--note-font-size', `${size}px`)
      // Fixed-width gaps between notes don't shrink proportionally with
      // font-size, so the first pass slightly under- or overshoots — one
      // correction pass closes that gap.
      natural = el.scrollWidth
      if (natural > available) {
        size = Math.max(MIN_FONT_SIZE, size * (available / natural))
        el.style.setProperty('--note-font-size', `${size}px`)
      }
    }

    const scheduleFit = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(fit)
    }

    scheduleFit()
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(el)
    return () => {
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
