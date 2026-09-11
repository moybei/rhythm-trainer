export default function TapTempoModal({ engine, isDesktop, onClose }) {
  const { state } = engine
  const count = state.tapTempoTapCount

  let status
  if (count === 0) status = 'Waiting for your first tap…'
  else status = `${state.bpm} BPM — averaging your last ${count} tap${count === 1 ? '' : 's'}`

  return (
    <div className="modal-backdrop modal-backdrop--calibration" onClick={onClose}>
      <div className="modal-card modal-card--calibration" onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">Tap Tempo</div>
        <div className="calibration-blurb">
          Tap along to your desired tempo{isDesktop ? ' (press X, or tap the button)' : ''} — BPM updates from the
          average of your last 8 taps.
        </div>
        <button
          type="button"
          className="calibration-tap"
          onPointerDown={(e) => {
            e.preventDefault()
            engine.registerTapTempoTap(e.timeStamp)
          }}
        >
          TAP{isDesktop ? ' (X)' : ''}
        </button>
        <div className="calibration-status">{status}</div>
        <button type="button" className="pill-button" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
