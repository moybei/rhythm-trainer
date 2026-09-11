import { useRef } from 'react'
import { useNativePointerDown } from '../hooks/useNativePointerDown.js'

export default function TapTempoModal({ engine, isDesktop, onClose }) {
  const { state } = engine
  const count = state.tapTempoTapCount
  const tapBtnRef = useRef(null)
  useNativePointerDown(tapBtnRef, (e) => engine.registerTapTempoTap(e.timeStamp))

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
        <button type="button" className="calibration-tap" ref={tapBtnRef}>
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
