const PAD_POSITIONS = {
  L1: { left: '37%', top: '26%' },
  R1: { left: '63%', top: '26%' },
  L2: { left: '20%', top: '66%' },
  R2: { left: '80%', top: '66%' },
}

// Judged taps fire on pointerdown, not click. A click only fires after the
// finger lifts (touchend) plus the browser's own tap-recognition delay —
// on a phone that alone can add 100-300ms of pure latency before the game
// even sees the tap, on top of whatever timestamp it's judged against. Using
// the pointerdown event's own `timeStamp` (mapped to audio-clock time, same
// as the keyboard path) means the game reacts the instant a finger lands,
// and judges against the moment contact actually happened rather than
// whenever this callback happened to get scheduled — a source of the
// jittery, seemingly-random extra delay touch input had before this.
function handleTapPointerDown(e, fire) {
  if (e.pointerType === 'mouse' && e.button !== 0) return // ignore right/middle click
  e.preventDefault() // stop the delayed compatibility mouse/click events from also firing this
  fire()
}

// Badge shown above a pad's letter after a judged tap (or an auto-missed
// note, for `pad`s representing that note's hand). Keyed on `feedback.seq`
// so React remounts the span (not just updates its text) on every new tap,
// which restarts the fade-in animation even if the same badge repeats.
//   - Critical Perfect: no badge at all (nothing patches tapFeedback for it)
//   - Perfect: just FAST/LATE, no tier label
//   - Great / Good: FAST/LATE on top, the colored tier name underneath
//   - Miss: no direction (a miss is never "early" or "late") — just "Miss"
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

  return (
    <div className="tap-area">
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
          <div
            className={`lr-zone${display.leftIsActive ? ' is-active' : ''}`}
            onPointerDown={(e) => handleTapPointerDown(e, () => engine.registerJudgedTap('L', e.timeStamp))}
          >
            <TapFeedback feedback={state.tapFeedback} pad="L" />
            <span className="lr-zone__letter" style={{ color: 'var(--l)' }}>
              L
            </span>
            {isDesktop && <span className="lr-zone__key">KEY&nbsp;{state.keyBinds.L}</span>}
          </div>
          <div
            className={`lr-zone${display.rightIsActive ? ' is-active' : ''}`}
            onPointerDown={(e) => handleTapPointerDown(e, () => engine.registerJudgedTap('R', e.timeStamp))}
          >
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
              className={`pad${pad.active ? ' is-active' : ''}`}
              style={PAD_POSITIONS[pad.id]}
              onPointerDown={(e) => handleTapPointerDown(e, () => engine.registerJudgedTap(pad.id, e.timeStamp))}
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
