import { useEffect, useState } from 'react'
import { useRhythmEngine } from './hooks/useRhythmEngine.js'
import { usePatternDisplay } from './hooks/usePatternDisplay.js'
import Header from './components/Header.jsx'
import MetronomeBar from './components/MetronomeBar.jsx'
import PatternBar from './components/PatternBar.jsx'
import TapArea from './components/TapArea.jsx'
import JudgementFooter from './components/JudgementFooter.jsx'
import SettingsModal from './components/SettingsModal.jsx'
import CalibrationModal from './components/CalibrationModal.jsx'

export default function App() {
  const engine = useRhythmEngine()
  const display = usePatternDisplay(engine.state)

  // Layout: auto-detected from the device's primary pointer (fine = mouse/
  // trackpad → desktop, coarse = touch → tablet), overridable from the
  // header pill at any time — the override is remembered in localStorage.
  const [layoutOverride, setLayoutOverrideState] = useState(() => {
    try {
      return localStorage.getItem('rhythm-trainer:layout') || null
    } catch {
      return null
    }
  })
  const setLayoutOverride = (mode) => {
    setLayoutOverrideState(mode)
    try {
      localStorage.setItem('rhythm-trainer:layout', mode)
    } catch {
      // localStorage unavailable — not fatal, just won't persist.
    }
  }
  const [autoLayout, setAutoLayout] = useState('desktop')
  useEffect(() => {
    const mq = window.matchMedia('(pointer: fine)')
    const update = () => setAutoLayout(mq.matches ? 'desktop' : 'tablet')
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  const layoutMode = layoutOverride || autoLayout
  const isDesktop = layoutMode === 'desktop'

  const [metronomeOpen, setMetronomeOpen] = useState(false)
  const [patternsOpen, setPatternsOpen] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const [judgementModeOpen, setJudgementModeOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <div className={`app${isDesktop ? '' : ' is-tablet'}`}>
      <Header layoutMode={layoutMode} onSetLayout={setLayoutOverride} />

      <MetronomeBar
        engine={engine}
        display={display}
        isOpen={metronomeOpen}
        onToggleOpen={() => setMetronomeOpen((v) => !v)}
        isDesktop={isDesktop}
      />

      <PatternBar
        engine={engine}
        display={display}
        isOpen={patternsOpen}
        onToggleOpen={() => setPatternsOpen((v) => !v)}
        onClose={() => setPatternsOpen(false)}
      />

      <TapArea
        engine={engine}
        display={display}
        isDesktop={isDesktop}
        modePickerOpen={modePickerOpen}
        onOpenModePicker={() => setModePickerOpen(true)}
        onCloseModePicker={() => setModePickerOpen(false)}
      />

      <JudgementFooter
        engine={engine}
        judgementModeOpen={judgementModeOpen}
        onToggleJudgementMode={() => setJudgementModeOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      {settingsOpen && (
        <SettingsModal
          engine={engine}
          isDesktop={isDesktop}
          onClose={() => {
            setSettingsOpen(false)
            engine.cancelRebind()
          }}
        />
      )}

      {engine.state.calibrationOpen && (
        <CalibrationModal
          engine={engine}
          display={display}
          isDesktop={isDesktop}
          onClose={engine.closeCalibration}
        />
      )}
    </div>
  )
}
