import { useEffect, useRef, useState } from 'react'

// Tracks the raw gap between consecutive events of one type, at the
// document level in the capture phase — before TapArea's own listener,
// before React, before anything else in this app's code runs. `filter`
// (optional) can reject events that shouldn't count (e.g. keyboard
// auto-repeat from a held key).
//
// Also tracks each event's AGE: performance.now() at the moment the
// listener runs, minus the event's own timeStamp. That number answers a
// question nothing else here can: whether `timeStamp` is when the
// hardware saw the touch (ages vary, and average a few ms) or merely when
// the browser got around to dispatching it (ages pin near zero, because
// the stamp is written moments before the dispatch). Only the first kind
// can be used to de-jitter timing — if touch timestamps are dispatch
// times, they carry the main thread's own hiccups inside them.
function useEventHistory(eventName, filter) {
  const [history, setHistory] = useState({ intervals: [], ages: [] })
  const lastRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (filter && !filter(e)) return
      const now = e.timeStamp
      const age = Math.round((performance.now() - now) * 10) / 10
      // Both derived values are computed HERE, not inside the updater: the
      // updater runs later, during render, by which point lastRef has
      // already moved on and every interval would read as zero.
      const interval = lastRef.current == null ? null : Math.round(now - lastRef.current)
      lastRef.current = now
      setHistory((prev) => ({
        intervals: interval == null ? prev.intervals : [...prev.intervals.slice(-29), interval],
        ages: [...prev.ages.slice(-29), age],
      }))
    }
    document.addEventListener(eventName, handler, { capture: true, passive: true })
    return () => document.removeEventListener(eventName, handler, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName])

  return history
}

function stats(values) {
  if (!values.length) return { min: 0, avg: 0, max: 0, spread: 0 }
  const min = Math.min(...values)
  const max = Math.max(...values)
  return {
    min,
    max,
    avg: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
    spread: Math.round((max - min) * 10) / 10,
  }
}

function Line({ label, values, unit = 'ms' }) {
  const s = stats(values)
  return (
    <>
      {label} — min {s.min} / avg {s.avg} / max {s.max} / spread {s.spread} {unit}
      {'\n'}
      {values.join(', ') || '(none yet)'}
      {'\n\n'}
    </>
  )
}

// Temporary diagnostic, not part of normal app UI — only mounts behind
// ?debugTap=1 in the URL.
//
// The point of this panel is to tell apart two failures that feel
// identical when you tap: the app receiving your taps unevenly (input),
// and the app receiving them perfectly but *playing* them unevenly
// (output). "SOUND spacing" is the decisive row — it is the interval
// between the audio times the hit sounds were actually scheduled at. If
// TAP spacing is tight and SOUND spacing is not, the problem is entirely
// on the output side; if both are loose by the same amount, the taps
// themselves arrived that way and no amount of audio work will fix it.
export default function TapTimingDebug({ engine }) {
  const touch = useEventHistory('touchstart')
  const pointer = useEventHistory('pointerdown', (e) => e.pointerType !== 'touch')
  const key = useEventHistory('keydown', (e) => !e.repeat) // ignore held-key auto-repeat

  // The engine's own view: what it decided each tap's sound time was.
  // Polled rather than pushed so the overlay can never add work to the
  // tap path it is supposed to be measuring.
  const [engineView, setEngineView] = useState({ clock: null, soundGaps: [], handlerAges: [] })
  useEffect(() => {
    const id = setInterval(() => {
      const taps = engine.tapDebugRef.current
      const soundGaps = []
      for (let i = 1; i < taps.length; i++) {
        soundGaps.push(Math.round((taps[i].soundTimeMs - taps[i - 1].soundTimeMs) * 10) / 10)
      }
      setEngineView({
        clock: engine.getClockStats(),
        soundGaps,
        handlerAges: taps.filter((t) => t.handlerAgeMs != null).map((t) => Math.round(t.handlerAgeMs * 10) / 10),
      })
    }, 400)
    return () => clearInterval(id)
  }, [engine])

  const c = engineView.clock
  const fmt = (v) => (v == null ? 'n/a' : Math.round(v * 100) / 100)

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
        maxHeight: '55vh',
        overflowY: 'auto',
      }}
    >
      {c
        ? `AUDIO — rate ${c.sampleRate}Hz  block ${fmt(c.blockMs)}ms  baseLatency ${fmt(c.baseLatencyMs)}ms  outputLatency ${fmt(
            c.outputLatencyMs,
          )}ms\n       hit lookahead ${fmt(c.lookaheadMs)}ms  worst handler delay ${fmt(c.worstHandlerDelayMs)}ms  pushed-late ${
            c.clampCount
          }/${c.scheduleCount}\n\n`
        : 'AUDIO — (tap once to start the audio engine)\n\n'}

      <Line label="SOUND spacing (scheduled hit-sound gaps)" values={engineView.soundGaps} />
      <Line label="TAP spacing — touchstart" values={touch.intervals} />
      <Line label="TAP spacing — mouse/pen pointerdown" values={pointer.intervals} />
      <Line label="TAP spacing — keydown" values={key.intervals} />
      <Line label="EVENT AGE — touchstart (0 = dispatch time, not hardware time)" values={touch.ages} />
      <Line label="EVENT AGE — keydown" values={key.ages} />
    </div>
  )
}
