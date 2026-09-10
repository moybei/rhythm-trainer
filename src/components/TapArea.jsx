const PAD_POSITIONS = {
  L1: { left: '37%', top: '26%' },
  R1: { left: '63%', top: '26%' },
  L2: { left: '20%', top: '66%' },
  R2: { left: '80%', top: '66%' },
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
            onClick={engine.registerJudgedTap}
          >
            <span className="lr-zone__letter" style={{ color: 'var(--l)' }}>
              L
            </span>
            {isDesktop && <span className="lr-zone__key">KEY&nbsp;{state.keyBinds.L}</span>}
          </div>
          <div
            className={`lr-zone${display.rightIsActive ? ' is-active' : ''}`}
            onClick={engine.registerJudgedTap}
          >
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
              onClick={engine.registerJudgedTap}
            >
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
