export default function CalibrationModal({ engine, display, isDesktop, onClose }) {
  return (
    <div className="modal-backdrop modal-backdrop--calibration" onClick={onClose}>
      <div className="modal-card modal-card--calibration" onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">Calibrate Offset</div>
        <div className="calibration-blurb">
          Listen to 8 clicks at 140 BPM, then tap along with the next 8{isDesktop ? ' (press X, or tap the button)' : ''}.
        </div>
        <button type="button" className="calibration-tap" onClick={engine.registerCalibrationTap}>
          TAP{isDesktop ? ' (X)' : ''}
        </button>
        <div className="calibration-status">{display.calibrationStatusLabel}</div>
        <button type="button" className="pill-button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  )
}
