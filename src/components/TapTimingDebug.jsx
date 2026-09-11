import { useEffect, useRef, useState } from 'react'

// Tracks the raw gap between consecutive events of one type, at the
// document level in the capture phase — before TapArea's own listener,
// before React, before anything else in this app's code runs. `filter`
// (optional) can reject events that shouldn't count (e.g. keyboard
// auto-repeat from a held key).
function useIntervalHistory(eventName, filter) {
  const [intervals, setIntervals] = useState([])
  const lastRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (filter && !filter(e)) return
      const now = e.timeStamp
      if (lastRef.current != null) {
        setIntervals((prev) => [...prev.slice(-29), Math.round(now - lastRef.current)])
      }
      lastRef.current = now
    }
    document.addEventListener(eventName, handler, { capture: true, passive: true })
    return () => document.removeEventListener(eventName, handler, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName])

  return intervals
}

function stats(intervals) {
  if (!intervals.length) return { min: 0, avg: 0, max: 0 }
  return {
    min: Math.min(...intervals),
    avg: Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length),
    max: Math.max(...intervals),
  }
}

// Temporary diagnostic, not part of normal app UI — only mounts behind
// ?debugTap=1 in the URL. Two independent channels so the same test
// session can compare touch/mouse taps against keyboard presses on the
// same device: if keyboard is tight and touch is wide, that points at the
// touch pipeline specifically; if both are similarly wide, it's likely
// just human tapping variability, not a touch-specific issue.
export default function TapTimingDebug() {
  const touchIntervals = useIntervalHistory('pointerdown')
  const keyIntervals = useIntervalHistory('keydown', (e) => !e.repeat) // ignore held-key auto-repeat

  const t = stats(touchIntervals)
  const k = stats(keyIntervals)

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'rgba(0,0,0,0.9)',
        color: '#5f5',
        fontFamily: 'monospace',
        fontSize: 11,
        lineHeight: 1.5,
        padding: '8px 12px',
        zIndex: 99999,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        borderTop: '1px solid #5f5',
        maxHeight: '45vh',
        overflowY: 'auto',
      }}
    >
      TOUCH/MOUSE intervals ms (last 30) — min {t.min} / avg {t.avg} / max {t.max}
      {'\n'}
      {touchIntervals.join(', ')}
      {'\n\n'}
      KEYBOARD intervals ms (last 30) — min {k.min} / avg {k.avg} / max {k.max}
      {'\n'}
      {keyIntervals.join(', ')}
    </div>
  )
}
