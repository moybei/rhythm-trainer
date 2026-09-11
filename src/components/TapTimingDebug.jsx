import { useEffect, useRef, useState } from 'react'

// Temporary diagnostic, not part of normal app UI — only mounts behind
// ?debugTap=1 in the URL. Measures the raw gap between consecutive
// pointerdown events as the browser delivers them, at the document level
// in the capture phase (before TapArea's own listener, before React,
// before anything else) — completely decoupled from audio playback,
// judgement logic, or rendering. If these intervals come back even, the
// touch-delivery pipeline is fine and the unevenness is downstream (audio
// playback/hardware); if they come back clustered/uneven, the taps
// themselves are arriving from iOS in bursts, before this app's code ever
// gets a chance to run.
export default function TapTimingDebug() {
  const [intervals, setIntervals] = useState([])
  const lastRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      const now = e.timeStamp
      if (lastRef.current != null) {
        const dt = Math.round(now - lastRef.current)
        setIntervals((prev) => [...prev.slice(-29), dt])
      }
      lastRef.current = now
    }
    document.addEventListener('pointerdown', handler, { capture: true, passive: true })
    return () => document.removeEventListener('pointerdown', handler, { capture: true })
  }, [])

  const avg = intervals.length ? Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length) : 0
  const max = intervals.length ? Math.max(...intervals) : 0
  const min = intervals.length ? Math.min(...intervals) : 0

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
      }}
    >
      TAP INTERVALS ms (last 30) — min {min} / avg {avg} / max {max}
      {'\n'}
      {intervals.join(', ')}
    </div>
  )
}
