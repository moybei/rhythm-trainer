import { useState } from 'react'
import { KEYBIND_META } from '../data/patterns.js'
import NumberField from './NumberField.jsx'
import { hardReload } from '../utils/hardReload.js'

function VolumeRow({ label, valuePercent, onChange }) {
  return (
    <div className="volume-row">
      <span className="volume-row__label">{label}</span>
      <input
        type="range"
        className="volume-row__slider"
        min="0"
        max="150"
        step="5"
        value={valuePercent}
        onChange={onChange}
      />
      <span className="volume-row__value">{valuePercent}%</span>
    </div>
  )
}

export default function SettingsModal({ engine, isDesktop, onClose }) {
  const { state } = engine
  const [reloading, setReloading] = useState(false)

  return (
    <div className="modal-backdrop modal-backdrop--settings" onClick={onClose}>
      <div className="modal-card modal-card--settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal-heading">Settings</div>

        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 12,
            paddingBottom: 16,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div>
            <div className="field-label">Offset (ms)</div>
            <NumberField
              className="field-input field-input--sm"
              value={state.offsetMs}
              onCommit={engine.handleOffsetInput}
            />
          </div>
          <button type="button" className="pill-button" onClick={engine.openCalibration}>
            Tap
          </button>
        </div>

        <div className="modal-heading" style={{ margin: '14px 0 4px' }}>
          Volume
        </div>
        <VolumeRow
          label="Metronome"
          valuePercent={Math.round(state.metronomeVolume * 100)}
          onChange={engine.handleMetronomeVolumeInput}
        />
        <VolumeRow
          label="Hit sound"
          valuePercent={Math.round(state.hitSoundVolume * 100)}
          onChange={engine.handleHitSoundVolumeInput}
        />
        <VolumeRow
          label="Miss sound"
          valuePercent={Math.round(state.missSoundVolume * 100)}
          onChange={engine.handleMissSoundVolumeInput}
        />
        <VolumeRow
          label="Guide sound"
          valuePercent={Math.round(state.guideVolume * 100)}
          onChange={engine.handleGuideVolumeInput}
        />

        {isDesktop && (
          <>
            <div className="modal-heading" style={{ margin: '14px 0 4px' }}>
              Keybinds
            </div>
            {KEYBIND_META.map((m) => {
              const isRebinding = state.rebindingAction === m.action
              return (
                <div className="keybind-row" key={m.action}>
                  <span className="keybind-row__label">{m.label}</span>
                  <div
                    className={`keybind-row__key${isRebinding ? ' is-rebinding' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      engine.startRebind(m.action)
                    }}
                  >
                    {isRebinding ? 'Press a key…' : state.keyBinds[m.action]}
                  </div>
                </div>
              )
            })}
          </>
        )}

        <div className="modal-heading" style={{ margin: '14px 0 4px' }}>
          App
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <span className="field-label" style={{ maxWidth: 200 }}>
            Stuck on an old version? Clear the cache and reload.
          </span>
          <button
            type="button"
            className="pill-button"
            disabled={reloading}
            onClick={() => {
              setReloading(true)
              hardReload()
            }}
          >
            {reloading ? 'Reloading…' : 'Hard Reload'}
          </button>
        </div>

        <button
          type="button"
          className="pill-button"
          style={{ marginTop: 16, alignSelf: 'flex-start' }}
          onClick={onClose}
        >
          Done
        </button>
      </div>
    </div>
  )
}
