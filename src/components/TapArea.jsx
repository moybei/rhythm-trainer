import { useEffect, useRef } from 'react'

const PAD_POSITIONS = {
  L1: { left: '37%', top: '26%' },
  R1: { left: '63%', top: '26%' },
  L2: { left: '20%', top: '66%' },
  R2: { left: '80%', top: '66%' },
}

// Badge shown above a pad's letter after a judged tap (or an auto-missed
// note, for `pad`s representing that note's hand). Keyed on `feedback.seq`
// so React remounts the span (not just updates its text) on every new tap,
// which restarts the fade-in animation even if the same badge repeats.
//   - Critical Perfect: no badge at all (nothing patches tapFeedback for it)
//   - Perfect: just FAST/LATE, no tier label
//   - Great / Good: FAST/LATE on top, the colored tier name underneath
//   - Miss: no direction (a miss is never "early" or "late") — just "Miss"
// No human can deliberately land two separate, distinct hits on the same
// pad faster than this — a gap smaller than it is touchscreen "chatter": a
// single hard, fast contact physically bouncing on the glass and getting
// sensed by the digitizer as two separate touch-down events a few
// milliseconds apart (the same phenomenon as mechanical switch bounce).
// Confirmed via a raw touch-timing diagnostic on a real device: genuine
// 0ms gaps between reported pointerdown events during fast single-pad
// tapping, which is physically impossible as two intentional taps.
const CHATTER_DEBOUNCE_MS = 25

function TapFeedback({ feedback, pad }) {
  if (!feedback || !feedback.targets.includes(pad)) return null
  const { tier, direction, seq } = feedback
  if (tier === 'miss') {
    return (
      <span key={seq} className="tap-feedback">
        <span className="tap-feedback__tier tap-feedback__tier--miss">Miss</span>
      </span>
    )
  }
  const tierLabel = tier === 'great' ? 'Great' : tier === 'good' ? 'Good' : null
  return (
    <span key={seq} className="tap-feedback">
      <span className={`tap-feedback__direction tap-feedback__direction--${direction}`}>
        {direction === 'fast' ? 'FAST' : 'LATE'}
      </span>
      {tierLabel && <span className={`tap-feedback__tier tap-feedback__tier--${tier}`}>{tierLabel}</span>}
    </span>
  )
}

export default function TapArea({ engine, display, isDesktop, modePickerOpen, onOpenModePicker, onCloseModePicker }) {
  const { state } = engine
  const isLR = state.tapMode === 'lr'
  const isPads4 = state.tapMode === 'pads4'
  const tapAreaRef = useRef(null)

  // Judged taps are wired up via a raw native pointerdown listener — one
  // delegated listener for the whole tap area, not a React onPointerDown
  // on each pad — mirroring exactly how keyboard input already works (a
  // plain window 'keydown' listener, entirely outside React's synthetic
  // event system). That turned out to matter: keyboard taps (already raw)
  // felt instant and even; touch taps (going through React's synthetic
  // dispatch on every pad) did not, even for physically even input. This
  // removes React's event-handling overhead from the touch path the same
  // way it was already absent from the keyboard path.
  const registerJudgedTapRef = useRef(engine.registerJudgedTap)
  useEffect(() => {
    registerJudgedTapRef.current = engine.registerJudgedTap
  })

  // Per-pad last-accepted timestamp, for the chatter debounce below.
  const lastAcceptedRef = useRef({})

  useEffect(() => {
    const el = tapAreaRef.current
    if (!el) return
    const onPointerDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return // ignore right/middle click
      const target = e.target.closest('[data-tap-pad]')
      if (!target) return
      e.preventDefault() // stop the delayed compatibility mouse/click events from also firing this
      const padId = target.dataset.tapPad
      const last = lastAcceptedRef.current[padId]
      if (last != null && e.timeStamp - last < CHATTER_DEBOUNCE_MS) return // touchscreen chatter, not a second tap
      lastAcceptedRef.current[padId] = e.timeStamp
      registerJudgedTapRef.current(padId, e.timeStamp)
    }
    el.addEventListener('pointerdown', onPointerDown, { passive: false })
    return () => el.removeEventListener('pointerdown', onPointerDown)
  }, [])

  return (
    <div className="tap-area" ref={tapAreaRef}>
      <div
        className="mode-pill"
        onClick={(e) => {
          e.stopPropagation()
          onOpenModePicker()
        }}
      >
        {isLR ? 'L / R' : '4 Pads'}
      </div>

      {modePickerOpen && (
        <div className="modal-backdrop" onClick={onCloseModePicker}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-heading">Tap Mode</div>
            <div
              className={`modal-choice${isLR ? ' is-selected' : ''}`}
              onClick={() => {
                engine.setTapMode('lr')
                onCloseModePicker()
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>L / R</span>
            </div>
            <div
              className={`modal-choice${isPads4 ? ' is-selected' : ''}`}
              onClick={() => {
                engine.setTapMode('pads4')
                onCloseModePicker()
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 14 }}>4 Pads</span>
            </div>
          </div>
        </div>
      )}

      {isLR && (
        <div className="lr-zones">
          <div data-tap-pad="L" className={`lr-zone${display.leftIsActive ? ' is-active' : ''}`}>
            <TapFeedback feedback={state.tapFeedback} pad="L" />
            <span className="lr-zone__letter" style={{ color: 'var(--l)' }}>
              L
            </span>
            {isDesktop && <span className="lr-zone__key">KEY&nbsp;{state.keyBinds.L}</span>}
          </div>
          <div data-tap-pad="R" className={`lr-zone${display.rightIsActive ? ' is-active' : ''}`}>
            <TapFeedback feedback={state.tapFeedback} pad="R" />
            <span className="lr-zone__letter" style={{ color: 'var(--r)' }}>
              R
            </span>
            {isDesktop && <span className="lr-zone__key">KEY&nbsp;{state.keyBinds.R}</span>}
          </div>
        </div>
      )}

      {isPads4 && (
        <div className="pads4">
          {[
            { id: 'L1', label: 'L1', color: 'var(--l)', active: display.padL1Active },
            { id: 'R1', label: 'R1', color: 'var(--r)', active: display.padR1Active },
            { id: 'L2', label: 'L2', color: 'var(--l)', active: display.padL2Active },
            { id: 'R2', label: 'R2', color: 'var(--r)', active: display.padR2Active },
          ].map((pad) => (
            <div
              key={pad.id}
              data-tap-pad={pad.id}
              className={`pad${pad.active ? ' is-active' : ''}`}
              style={PAD_POSITIONS[pad.id]}
            >
              <TapFeedback feedback={state.tapFeedback} pad={pad.id} />
              <span className="pad__letter" style={{ color: pad.color }}>
                {pad.label}
              </span>
              {isDesktop && <span className="pad__key">KEY&nbsp;{state.keyBinds[pad.id]}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
