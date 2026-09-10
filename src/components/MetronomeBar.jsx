import { ChevronDownIcon, PauseIcon, PlayIcon } from './icons.jsx'

export default function MetronomeBar({ engine, display, isOpen, onToggleOpen }) {
  const { state } = engine
  const isProgrammed = state.bpmMode === 'programmed'

  return (
    <div className="metronome-bar">
      <div className="metronome-bar__head" onClick={onToggleOpen}>
        <button
          type="button"
          className="play-button"
          onClick={(e) => {
            e.stopPropagation()
            engine.togglePlay()
          }}
        >
          {state.isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>
        <span className="metronome-bar__bpm">{state.bpm}</span>
        <span className="metronome-bar__bpm-label">BPM</span>
        <span className="metronome-bar__divider" />
        <span className="metronome-bar__mode">{isProgrammed ? 'Programmed' : 'Static'}</span>

        {state.inLeadin && (
          <div className="leadin">
            {/* Keyed on leadinFlashSeq so this remounts — and its flash
                animation restarts — on every single lead-in beat. */}
            <span key={state.leadinFlashSeq} className="leadin__bpm">
              {state.targetBpm}
            </span>
            <span className="leadin__label">BPM</span>
            <div className="leadin__dots">
              {display.leadinDots.map((dot) => (
                <div key={dot.key} className={`leadin__dot${dot.isFilled ? ' is-filled' : ''}`} />
              ))}
            </div>
          </div>
        )}

        <ChevronDownIcon open={isOpen} />
      </div>

      {isOpen && (
        <div className="metronome-drawer" onClick={(e) => e.stopPropagation()}>
          <div className="metronome-drawer__row">
            <div>
              <div className="field-label">BPM</div>
              <input
                type="number"
                className="field-input field-input--sm"
                value={state.bpm}
                onChange={engine.handleBpmInput}
              />
            </div>
            <button type="button" className="pill-button" onClick={engine.openTapTempo}>
              TAP
            </button>

            <div className="small-segmented">
              <button
                type="button"
                className={`small-segmented__option${!isProgrammed ? ' is-active' : ''}`}
                onClick={engine.setStatic}
              >
                Static
              </button>
              <button
                type="button"
                className={`small-segmented__option${isProgrammed ? ' is-active' : ''}`}
                onClick={engine.setProgrammed}
              >
                Programmed
              </button>
            </div>

            <div className="toggle-row" onClick={engine.toggleAccent}>
              <span className="toggle-row__label">Accent beat 1</span>
              <div className={`toggle${state.accentEnabled ? ' is-on' : ''}`}>
                <div className="toggle__dot" />
              </div>
            </div>
            <div className="toggle-row" onClick={engine.toggleGuide}>
              <span className="toggle-row__label">Guide sound</span>
              <div className={`toggle${state.guideEnabled ? ' is-on' : ''}`}>
                <div className="toggle__dot" />
              </div>
            </div>
            <div className="toggle-row" onClick={engine.toggleHitSound}>
              <span className="toggle-row__label">Hit sound</span>
              <div className={`toggle${state.hitSoundEnabled ? ' is-on' : ''}`}>
                <div className="toggle__dot" />
              </div>
            </div>
            <div className="toggle-row" onClick={engine.toggleShowTargetPad}>
              <span className="toggle-row__label">Show target pad</span>
              <div className={`toggle${state.showTargetPad ? ' is-on' : ''}`}>
                <div className="toggle__dot" />
              </div>
            </div>
          </div>

          {isProgrammed && (
            <div className="metronome-drawer__row">
              <div>
                <div className="field-label">Lead-in beats</div>
                <input
                  type="number"
                  className="field-input field-input--sm"
                  value={state.leadIn}
                  onChange={engine.handleLeadInInput}
                />
              </div>
              <div>
                <div className="field-label">Ramp (+BPM)</div>
                <input
                  type="number"
                  className="field-input field-input--sm"
                  value={state.rampAmount}
                  onChange={engine.handleRampAmountInput}
                />
              </div>
              <div>
                <div className="field-label">Every</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="number"
                    className="field-input"
                    style={{ width: 80 }}
                    value={state.rampInterval}
                    onChange={engine.handleRampIntervalInput}
                  />
                  <div className="small-segmented small-segmented--tight">
                    <button
                      type="button"
                      className={`small-segmented__option small-segmented__option--tight${
                        state.rampUnit === 'rep' ? ' is-active' : ''
                      }`}
                      onClick={engine.setRampRep}
                    >
                      Rep
                    </button>
                    <button
                      type="button"
                      className={`small-segmented__option small-segmented__option--tight${
                        state.rampUnit === 'time' ? ' is-active' : ''
                      }`}
                      onClick={engine.setRampTime}
                    >
                      Sec
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
