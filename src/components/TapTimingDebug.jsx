import { useEffect, useRef, useState } from 'react'
import { chatterStats } from '../utils/chatterFilter.js'
import { tapRepairStats } from '../utils/tapTimestampRepair.js'

// Records every event of one type at the document level in the capture
// phase — before TapArea's own listener, before React, before anything
// else in this app's code runs. `filter` (optional) rejects events that
// shouldn't count (e.g. keyboard auto-repeat from a held key).
//
// Everything accumulates into a ref and nothing re-renders here: an
// earlier version called setState on every event, which re-rendered six
// thirty-number lists on the main thread on every single tap. That is
// exactly the kind of work that delays the NEXT event's delivery, so the
// panel was inflating the event ages and handler delays it existed to
// measure. The overlay now repaints on a slow timer instead, and the tap
// path stays as light with it open as without.
function useEventRecorder(eventName, filter) {
  const ref = useRef({ intervals: [], ages: [], events: 0, touches: 0, padTouches: 0 })
  const lastRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (filter && !filter(e)) return
      const now = e.timeStamp
      const rec = ref.current
      rec.events++
      // One touchstart can carry several touches — two fingers landing
      // inside the same frame arrive as a single event. Counting events
      // instead of touches would make that look like a dropped tap, which
      // is the exact question this panel is here to answer.
      rec.touches += e.changedTouches ? e.changedTouches.length : 1
      // Of those, the ones that actually landed on a pad. Without this, a
      // tap on the play button or on this very overlay is indistinguishable
      // from a pad tap the engine lost — which is the whole question the
      // counters beside it exist to answer. Computed here rather than in
      // TapArea so the diagnostic adds no work to the real input path.
      for (const pt of e.changedTouches ? Array.from(e.changedTouches) : [e]) {
        if (pt.target && pt.target.closest && pt.target.closest('[data-tap-pad]')) rec.padTouches++
      }
      if (lastRef.current != null) {
        rec.intervals.push(Math.round(now - lastRef.current))
        if (rec.intervals.length > 30) rec.intervals.shift()
      }
      lastRef.current = now
      rec.ages.push(Math.round((performance.now() - now) * 10) / 10)
      if (rec.ages.length > 30) rec.ages.shift()
    }
    document.addEventListener(eventName, handler, { capture: true, passive: true })
    return () => document.removeEventListener(eventName, handler, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventName])

  return ref
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

function line(label, values) {
  const s = stats(values)
  return `${label} — min ${s.min} / avg ${s.avg} / max ${s.max} / spread ${s.spread} ms\n${values.join(', ') || '(none yet)'}\n\n`
}

const fmt = (v) => (v == null ? 'n/a' : Math.round(v * 100) / 100)

// Temporary diagnostic, not part of normal app UI — only mounts behind
// ?debugTap=1 in the URL.
//
// It exists to tell apart three failures that all feel identical when you
// tap, and which no amount of listening can separate:
//
//   - the app receives your taps unevenly (input),
//   - it receives them fine but PLAYS them unevenly (output),
//   - it does both correctly but so late that you can't steer your own
//     hands by what you hear (latency).
//
// "SOUND spacing" against "TAP spacing" settles the first two: if SOUND
// tracks TAP, output is clean and anything left is input.
//
// The third is the one people misread as unevenness — past roughly 100ms
// the auditory feedback loop stops working, so the tapping itself
// degrades and it looks like an app bug. But it cannot be totalled up
// honestly here: `lookahead` is measured and trustworthy, `outputLatency`
// is whatever the browser chooses to state (an iPhone reported the same
// 163ms over AirPods and over its own speaker, which cannot both be
// true), and the delay between a finger and the digitiser noticing isn't
// visible from JS at all. Calibrate measures the real round trip end to
// end, so that is what these numbers should be sanity-checked against
// rather than summed.
//
// The counter line catches taps going missing, and says where: "on a
// pad" is what the digitiser reported landing on one, "judged" is how
// many reached the engine, "chatter-rejected" is how many this app threw
// away on purpose, and "repaired" is how many carried a timestamp iOS had
// collapsed onto the previous tap's and had to have rebuilt.
export default function TapTimingDebug({ engine }) {
  const touch = useEventRecorder('touchstart')
  const pointer = useEventRecorder('pointerdown', (e) => e.pointerType !== 'touch')
  const key = useEventRecorder('keydown', (e) => !e.repeat) // ignore held-key auto-repeat

  const [text, setText] = useState('')
  useEffect(() => {
    const render = () => {
      const c = engine.getClockStats()
      const taps = engine.tapDebugRef.current
      const soundGaps = []
      for (let i = 1; i < taps.length; i++) {
        soundGaps.push(Math.round((taps[i].soundTimeMs - taps[i - 1].soundTimeMs) * 10) / 10)
      }
      const t = touch.current
      const chatter = chatterStats()
      let out = c
        ? `AUDIO — rate ${c.sampleRate}Hz  block ${fmt(c.blockMs)}ms  baseLatency ${fmt(c.baseLatencyMs)}ms\n` +
          `        lookahead ${fmt(c.lookaheadMs)}ms (what this app adds, measured)\n` +
          // Deliberately not folded into a single "tap -> ear" figure any
          // more. On an iPhone this read an identical 163ms over AirPods
          // and over the built-in speaker, which cannot both be true —
          // real output latency differs by 100ms+ between those routes. So
          // it is a number the browser states, not one it measures, and
          // presenting a total built on it invented a precision this panel
          // does not have. Calibrate is the honest measurement: the offset
          // it lands on is the whole round trip, ears and fingers included.
          `        outputLatency ${fmt(c.outputLatencyMs)}ms (browser-reported, NOT verified — trust Calibrate over this)\n` +
          `        input delay p90 ${fmt(c.handlerDelayMs)}ms / worst ${fmt(c.worstHandlerDelayMs)}ms  pushed-late ${c.clampCount}/${
            c.scheduleCount
          }\n`
        : 'AUDIO — (tap once to start the audio engine)\n'
      out += `        touches ${t.touches} (on a pad: ${t.padTouches}) / events ${t.events} / judged ${engine.judgedTapCountRef.current}\n`
      out += `        chatter-rejected ${chatter.rejectedCount} / collapsed timestamps repaired ${tapRepairStats().repairedCount}\n`
      if (chatter.recent.length) {
        out += `        rejected: ${chatter.recent.map((r) => `${r.key} ev+${r.eventGap} arr+${r.arrivalGap}`).join(' | ')}\n`
      }
      out += '\n'
      out += line('SOUND spacing (scheduled hit-sound gaps)', soundGaps)
      out += line('TAP spacing — touchstart', t.intervals)
      out += line('TAP spacing — mouse/pen pointerdown', pointer.current.intervals)
      out += line('TAP spacing — keydown', key.current.intervals)
      out += line('EVENT AGE — touchstart (0 = dispatch time, not hardware time)', t.ages)
      out += line('EVENT AGE — keydown', key.current.ages)
      setText(out)
    }
    render()
    const id = setInterval(render, 500)
    return () => clearInterval(id)
  }, [engine, touch, pointer, key])

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
      {text}
    </div>
  )
}
