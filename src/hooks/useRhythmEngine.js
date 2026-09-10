import { useCallback, useEffect, useRef, useState } from 'react'
import { currentPattern, flattenPattern, DEFAULT_KEYBINDS } from '../data/patterns.js'
import { playClick, playGuide, playHitSound, playLeadInClick, preloadSamples } from '../audio/sound.js'

const initialState = {
  bpm: 120,
  bpmMode: 'static', // 'static' | 'programmed'
  leadIn: 8,
  rampAmount: 5,
  rampUnit: 'rep', // 'rep' | 'time'
  rampInterval: 1,
  targetBpm: 120,

  tapMode: 'lr', // 'lr' | 'pads4'
  selectedPatternId: 'single',
  mirrored: false,

  tapTempoOpen: false,
  tapTempoTapCount: 0,

  accentEnabled: true,
  guideEnabled: true,
  hitSoundEnabled: true,
  showTargetPad: true,

  judgementMode: 'maimai',
  judgementCounts: { critical: 0, perfect: 0, great: 0, good: 0, miss: 0 },
  missedIndex: -1,
  tapFeedback: null, // { pad, direction: 'fast' | 'late', seq } — transient, not persisted

  isPlaying: false,
  activeIndex: -1,
  inLeadin: false,
  leadinCount: 0,
  leadInTotal: 0,
  leadinFlashSeq: 0, // bumped on every lead-in beat so the UI can flash once per hit

  offsetMs: 0,
  keyBinds: DEFAULT_KEYBINDS,
  rebindingAction: null,

  metronomeVolume: 1,
  hitSoundVolume: 1,
  guideVolume: 1,

  calibrationOpen: false,
  calibrationRunning: false,
  calibrationInTapPhase: false,
  calibrationTapsCollected: 0,
  calibrationResultMs: null,
}

// Settings persisted to localStorage — everything a user deliberately
// configures. Deliberately excludes session/transient state (isPlaying,
// judgementCounts, calibration progress, etc.).
const STORAGE_KEY = 'rhythm-trainer:settings'
const PERSISTED_KEYS = [
  'bpm',
  'bpmMode',
  'leadIn',
  'rampAmount',
  'rampUnit',
  'rampInterval',
  'tapMode',
  'selectedPatternId',
  'mirrored',
  'accentEnabled',
  'guideEnabled',
  'hitSoundEnabled',
  'showTargetPad',
  'judgementMode',
  'offsetMs',
  'keyBinds',
  'metronomeVolume',
  'hitSoundVolume',
  'guideVolume',
]

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    const out = {}
    for (const key of PERSISTED_KEYS) {
      if (parsed[key] !== undefined) out[key] = parsed[key]
    }
    // Merge keyBinds against the defaults so a future new action never ends
    // up undefined just because an older saved settings blob predates it.
    if (out.keyBinds) out.keyBinds = { ...DEFAULT_KEYBINDS, ...out.keyBinds }
    return out
  } catch {
    return {}
  }
}

// A rhythm-trainer playback + judgement engine. State that the UI reads
// lives in React state; scheduling internals (audio-clock timers, running
// counters) live in refs so the interval/rAF callbacks always see the
// latest values instead of a stale closure — that's what `stateRef` is for.
export function useRhythmEngine() {
  const [state, setState] = useState(() => ({ ...initialState, ...loadPersistedState() }))
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])

  // Persist settings whenever one of them actually changes — deliberately
  // depends on the individual fields (not the whole `state` object), so
  // this doesn't write on every playback tick (activeIndex etc. change far
  // more often than settings do).
  useEffect(() => {
    try {
      const toSave = {}
      for (const key of PERSISTED_KEYS) toSave[key] = state[key]
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      // localStorage unavailable (private mode, quota, etc.) — not fatal.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, PERSISTED_KEYS.map((key) => state[key]))

  const patch = useCallback((updates) => {
    setState((prev) => ({ ...prev, ...(typeof updates === 'function' ? updates(prev) : updates) }))
  }, [])

  // --- refs: scheduler-only internals, never read by React render ---
  const audioCtxRef = useRef(null)
  const schedulerTimerRef = useRef(null)
  const rafIdRef = useRef(null)
  const nextNoteTimeRef = useRef(0)
  const hitCounterRef = useRef(0)
  const beatCounterRef = useRef(0)
  const leadBeatsRemainingRef = useRef(0)
  const phaseRef = useRef('idle') // 'idle' | 'leadin' | 'pattern'
  const currentBpmRef = useRef(120)
  const repsSinceRampRef = useRef(0)
  const pendingRampRef = useRef(false)
  const rampStartTimeRef = useRef(0)
  const scheduledEventsRef = useRef([]) // [{time, rowIndex}]
  const currentHitsRef = useRef([])
  const lastPatternIdRef = useRef(null)
  const missedIndexTimerRef = useRef(null)
  const tapFeedbackSeqRef = useRef(0)
  const tapFeedbackTimerRef = useRef(null)
  const leadinFlashSeqRef = useRef(0)

  const calSchedulerTimerRef = useRef(null)
  const calNextTimeRef = useRef(0)
  const calBeatIndexRef = useRef(0)
  const calScheduledBeatTimesRef = useRef([])
  const calDeltasRef = useRef([])

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      audioCtxRef.current = new AC()
      preloadSamples(audioCtxRef.current)
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }, [])

  // ---- simple field setters ----
  const handleBpmInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ bpm: Math.max(20, Math.min(300, v)) })
    },
    [patch],
  )
  const handleLeadInInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ leadIn: Math.max(0, Math.min(64, v)) })
    },
    [patch],
  )
  const handleRampAmountInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ rampAmount: Math.max(1, Math.min(60, v)) })
    },
    [patch],
  )
  const handleRampIntervalInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ rampInterval: Math.max(1, Math.min(999, v)) })
    },
    [patch],
  )
  const handleOffsetInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ offsetMs: Math.max(-300, Math.min(300, v)) })
    },
    [patch],
  )
  // Volume sliders are 0-150 in the UI (percent), stored as a 0-1.5 gain
  // multiplier so 100% reproduces exactly today's tuned default levels.
  const handleMetronomeVolumeInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ metronomeVolume: Math.max(0, Math.min(150, v)) / 100 })
    },
    [patch],
  )
  const handleHitSoundVolumeInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ hitSoundVolume: Math.max(0, Math.min(150, v)) / 100 })
    },
    [patch],
  )
  const handleGuideVolumeInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ guideVolume: Math.max(0, Math.min(150, v)) / 100 })
    },
    [patch],
  )
  // ---- tap tempo: opens a small UI where every "X" press (or tap of the
  // on-screen button) is logged; the BPM field updates live from the
  // average of the last 8 taps. Gating "X" on tapTempoOpen (rather than
  // treating it as a global tap-tempo hotkey) is what lets the player bind
  // "X" to one of the L/R/pad keys elsewhere without the two colliding.
  const tapTempoTimestampsRef = useRef([])

  const openTapTempo = useCallback(() => {
    tapTempoTimestampsRef.current = []
    patch({ tapTempoOpen: true, tapTempoTapCount: 0 })
  }, [patch])

  const closeTapTempo = useCallback(() => {
    patch({ tapTempoOpen: false })
  }, [patch])

  const registerTapTempoTap = useCallback(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const taps = tapTempoTimestampsRef.current
    const last = taps.length ? taps[taps.length - 1] : null
    // A long gap since the last tap means the player paused and is starting
    // a fresh tempo, not continuing the old one — drop the stale taps.
    if (last != null && now - last > 2000) taps.length = 0
    taps.push(now)
    if (taps.length > 8) taps.shift() // average over the last 8 taps
    if (taps.length >= 2) {
      let totalInterval = 0
      for (let i = 1; i < taps.length; i++) totalInterval += taps[i] - taps[i - 1]
      const avgInterval = totalInterval / (taps.length - 1)
      const bpm = Math.max(20, Math.min(300, Math.round(60000 / avgInterval)))
      patch({ bpm, tapTempoTapCount: taps.length })
    } else {
      patch({ tapTempoTapCount: taps.length })
    }
  }, [patch])

  const setStatic = useCallback(() => patch({ bpmMode: 'static' }), [patch])
  const setProgrammed = useCallback(() => patch({ bpmMode: 'programmed' }), [patch])
  const setRampRep = useCallback(() => {
    pendingRampRef.current = false
    if (audioCtxRef.current) rampStartTimeRef.current = audioCtxRef.current.currentTime
    patch({ rampUnit: 'rep', rampInterval: 1 })
  }, [patch])
  const setRampTime = useCallback(() => {
    pendingRampRef.current = false
    if (audioCtxRef.current) rampStartTimeRef.current = audioCtxRef.current.currentTime
    patch({ rampUnit: 'time', rampInterval: 60 })
  }, [patch])

  const setTapMode = useCallback((mode) => patch({ tapMode: mode }), [patch])
  const selectPattern = useCallback((id) => patch({ selectedPatternId: id }), [patch])
  const toggleMirror = useCallback(() => patch((prev) => ({ mirrored: !prev.mirrored })), [patch])
  const toggleAccent = useCallback(() => patch((prev) => ({ accentEnabled: !prev.accentEnabled })), [patch])
  const toggleGuide = useCallback(() => patch((prev) => ({ guideEnabled: !prev.guideEnabled })), [patch])
  const toggleHitSound = useCallback(() => patch((prev) => ({ hitSoundEnabled: !prev.hitSoundEnabled })), [patch])
  const toggleShowTargetPad = useCallback(
    () => patch((prev) => ({ showTargetPad: !prev.showTargetPad })),
    [patch],
  )
  const setJudgementMode = useCallback((mode) => patch({ judgementMode: mode }), [patch])
  const resetJudgementCounts = useCallback(
    () => patch({ judgementCounts: { critical: 0, perfect: 0, great: 0, good: 0, miss: 0 } }),
    [patch],
  )
  const startRebind = useCallback((action) => patch({ rebindingAction: action }), [patch])
  const cancelRebind = useCallback(() => patch({ rebindingAction: null }), [patch])

  // ---- judged tap (real-time, maimai-style windows) ----
  // `padId` (one of 'L' | 'R' | 'L1' | 'R1' | 'L2' | 'R2') identifies which
  // button/key triggered this tap, purely so the FAST/LATE badge can be
  // shown on that specific button — timing judgement itself doesn't care
  // which pad was hit, only when.
  const registerJudgedTap = useCallback(
    (padId) => {
      const s = stateRef.current
      const ctx = ensureAudioCtx()
      if (!s.isPlaying || scheduledEventsRef.current.length === 0) {
        // Nothing playing to judge against — still confirm the pad/key works
        // with an audible hit sound (same sample as a Perfect hit), just with
        // no tier, no count, and no FAST/LATE badge (nothing to be early or
        // late relative to).
        if (s.hitSoundEnabled) playHitSound(ctx, ctx.currentTime, 'idle', s.hitSoundVolume)
        return
      }
      const now = ctx.currentTime - s.offsetMs / 1000
      let nearest = null
      let bestAbsDelta = Infinity
      let bestSignedDelta = 0
      for (const ev of scheduledEventsRef.current) {
        const signed = ev.time - now // positive: beat is still ahead (tap was early/FAST); negative: beat already passed (tap was LATE)
        const d = Math.abs(signed)
        if (d < bestAbsDelta) {
          bestAbsDelta = d
          bestSignedDelta = signed
          nearest = ev
        }
      }
      if (!nearest) return
      const deltaMs = bestAbsDelta * 1000
      let tier
      if (deltaMs <= 16.66) tier = 'critical'
      else if (deltaMs <= 50) tier = 'perfect'
      else if (deltaMs <= 100) tier = 'great'
      else if (deltaMs <= 150) tier = 'good'
      else tier = 'miss'

      if (s.hitSoundEnabled) playHitSound(ctx, ctx.currentTime, tier, s.hitSoundVolume)

      // Critical Perfect is treated as "on time" — no FAST/LATE badge.
      // Every other tier (including Miss) shows which way you drifted.
      if (padId) {
        if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current)
        if (tier === 'critical') {
          patch({ tapFeedback: null })
        } else {
          const direction = bestSignedDelta > 0 ? 'fast' : 'late'
          tapFeedbackSeqRef.current += 1
          const seq = tapFeedbackSeqRef.current
          patch({ tapFeedback: { pad: padId, direction, seq } })
          tapFeedbackTimerRef.current = setTimeout(() => {
            patch((prev) => (prev.tapFeedback && prev.tapFeedback.seq === seq ? { tapFeedback: null } : {}))
          }, 600)
        }
      }

      if (tier === 'miss') {
        if (missedIndexTimerRef.current) clearTimeout(missedIndexTimerRef.current)
        const missIdx = nearest.rowIndex
        patch((prev) => ({
          missedIndex: missIdx,
          judgementCounts: { ...prev.judgementCounts, miss: prev.judgementCounts.miss + 1 },
        }))
        missedIndexTimerRef.current = setTimeout(() => {
          patch({ missedIndex: -1 })
        }, 450)
      } else {
        patch((prev) => ({
          judgementCounts: { ...prev.judgementCounts, [tier]: prev.judgementCounts[tier] + 1 },
        }))
      }
    },
    [patch, ensureAudioCtx],
  )

  // Bumps the tempo and, if lead-in beats are configured, re-runs the
  // count-in at the new BPM before the pattern resumes — a ramp is never
  // sprung on the player mid-tap, they always get a fresh count-in first.
  const applyRamp = useCallback(
    (time) => {
      const s = stateRef.current
      currentBpmRef.current = Math.min(300, currentBpmRef.current + s.rampAmount)
      repsSinceRampRef.current = 0
      pendingRampRef.current = false
      if (s.leadIn > 0) {
        phaseRef.current = 'leadin'
        leadBeatsRemainingRef.current = s.leadIn
        beatCounterRef.current = 0
        rampStartTimeRef.current = time
        nextNoteTimeRef.current = time + 60 / currentBpmRef.current
        patch({
          inLeadin: true,
          leadinCount: leadBeatsRemainingRef.current,
          leadInTotal: leadBeatsRemainingRef.current,
          targetBpm: Math.round(currentBpmRef.current),
        })
      } else {
        rampStartTimeRef.current = time
        patch({ bpm: Math.round(currentBpmRef.current) })
      }
    },
    [patch],
  )

  // ---- playback scheduler ----
  const scheduleOneEvent = useCallback(
    (time) => {
      const s = stateRef.current
      const ctx = audioCtxRef.current
      const pattern = currentPattern(s.selectedPatternId)

      if (phaseRef.current === 'leadin') {
        // Every lead-in beat sounds identical — unlike the pattern's beat-1
        // accent, the count-in shouldn't hint at bar position.
        playLeadInClick(ctx, time, false, s.metronomeVolume)
        leadBeatsRemainingRef.current--
        leadinFlashSeqRef.current++
        patch({
          leadinCount: Math.max(0, leadBeatsRemainingRef.current),
          leadinFlashSeq: leadinFlashSeqRef.current,
        })
        const beatDur = 60 / currentBpmRef.current
        nextNoteTimeRef.current = time + beatDur
        if (leadBeatsRemainingRef.current <= 0) {
          phaseRef.current = 'pattern'
          hitCounterRef.current = 0
          beatCounterRef.current = 0
          repsSinceRampRef.current = 0
          pendingRampRef.current = false
          rampStartTimeRef.current = nextNoteTimeRef.current
          patch({ inLeadin: false, bpm: Math.round(currentBpmRef.current) })
        }
        return
      }

      const cacheKey = pattern.id + (s.mirrored ? ':m' : '')
      if (lastPatternIdRef.current !== cacheKey) {
        currentHitsRef.current = flattenPattern(pattern, s.mirrored)
        lastPatternIdRef.current = cacheKey
      }
      const hits = currentHitsRef.current
      const total = hits.length
      const hit = hits[hitCounterRef.current % total]
      const group = hit.group
      const isBeatStart = hit.isBeatStart

      if (isBeatStart) {
        const isDown = s.accentEnabled && beatCounterRef.current % 4 === 0
        playClick(ctx, time, isDown, s.metronomeVolume)
        beatCounterRef.current++
      }
      // Ramp trigger: for time mode, just flag it — the actual BPM bump is
      // deferred to the next rep boundary below, so it never lands
      // mid-pattern (rep mode is naturally already rep-boundary-aligned).
      if (s.bpmMode === 'programmed' && s.rampUnit === 'time' && !pendingRampRef.current) {
        const elapsed = time - rampStartTimeRef.current
        if (elapsed >= s.rampInterval) pendingRampRef.current = true
      }

      const hand = hit.hand
      if (s.guideEnabled) playGuide(ctx, time, hand, s.guideVolume)

      const rowIndex = hitCounterRef.current % total
      scheduledEventsRef.current.push({ time, rowIndex })
      if (scheduledEventsRef.current.length > 96) scheduledEventsRef.current.shift()

      hitCounterRef.current++
      const subDur = 60 / currentBpmRef.current / group
      nextNoteTimeRef.current = time + subDur

      // A "rep" = one full playthrough of the pattern. Only ramp right
      // here, at the seam between reps, so tempo never jumps mid-pattern.
      if (s.bpmMode === 'programmed' && hitCounterRef.current % total === 0) {
        if (s.rampUnit === 'rep') {
          repsSinceRampRef.current++
          if (repsSinceRampRef.current >= s.rampInterval) applyRamp(time)
        } else if (pendingRampRef.current) {
          applyRamp(time)
        }
      }
    },
    [patch, applyRamp],
  )

  const scheduleTick = useCallback(() => {
    const ctx = audioCtxRef.current
    const lookahead = 0.12
    let guard = 0
    while (nextNoteTimeRef.current < ctx.currentTime + lookahead && guard < 64) {
      scheduleOneEvent(nextNoteTimeRef.current)
      guard++
    }
  }, [scheduleOneEvent])

  const updateHighlight = useCallback(() => {
    if (!stateRef.current.isPlaying || !audioCtxRef.current) return
    const now = audioCtxRef.current.currentTime
    let idx = -1
    for (let i = scheduledEventsRef.current.length - 1; i >= 0; i--) {
      if (scheduledEventsRef.current[i].time <= now) {
        idx = scheduledEventsRef.current[i].rowIndex
        break
      }
    }
    if (idx !== stateRef.current.activeIndex) patch({ activeIndex: idx })
    rafIdRef.current = requestAnimationFrame(updateHighlight)
  }, [patch])

  const startPlayback = useCallback(() => {
    const ctx = ensureAudioCtx()
    const s = stateRef.current
    currentBpmRef.current = s.bpm
    hitCounterRef.current = 0
    beatCounterRef.current = 0
    repsSinceRampRef.current = 0
    pendingRampRef.current = false
    rampStartTimeRef.current = ctx.currentTime
    // Static mode always gets a fixed 4-beat count-in; Programmed mode uses
    // the user-configured lead-in (default 8).
    leadBeatsRemainingRef.current = s.bpmMode === 'programmed' ? s.leadIn : 4
    phaseRef.current = leadBeatsRemainingRef.current > 0 ? 'leadin' : 'pattern'
    nextNoteTimeRef.current = ctx.currentTime + 0.12
    scheduledEventsRef.current = []
    patch({
      isPlaying: true,
      activeIndex: -1,
      inLeadin: phaseRef.current === 'leadin',
      leadinCount: leadBeatsRemainingRef.current,
      leadInTotal: leadBeatsRemainingRef.current,
      targetBpm: Math.round(currentBpmRef.current),
    })
    schedulerTimerRef.current = setInterval(scheduleTick, 25)
    rafIdRef.current = requestAnimationFrame(updateHighlight)
  }, [ensureAudioCtx, patch, scheduleTick, updateHighlight])

  const stopPlayback = useCallback(() => {
    if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current)
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    schedulerTimerRef.current = null
    rafIdRef.current = null
    patch({ isPlaying: false, activeIndex: -1, inLeadin: false })
  }, [patch])

  const togglePlay = useCallback(() => {
    if (stateRef.current.isPlaying) stopPlayback()
    else startPlayback()
  }, [startPlayback, stopPlayback])

  // ---- offset calibration: 8-beat count-in at 140 BPM, then 8 beats the
  // user taps along with. The average (tap time - beat time) across those
  // 8 taps becomes the new offsetMs, so future taps subtract that same
  // consistent lag/lead back out. ----
  const calScheduleOneBeat = useCallback(
    (time) => {
      const ctx = audioCtxRef.current
      const bpm = 140
      const beatDur = 60 / bpm
      const isTapPhase = calBeatIndexRef.current >= 8
      playLeadInClick(ctx, time, calBeatIndexRef.current % 4 === 0, stateRef.current.metronomeVolume)
      if (isTapPhase) {
        calScheduledBeatTimesRef.current.push(time)
        if (!stateRef.current.calibrationInTapPhase) patch({ calibrationInTapPhase: true })
      }
      calBeatIndexRef.current++
      calNextTimeRef.current = time + beatDur
      if (calBeatIndexRef.current >= 16) {
        if (calSchedulerTimerRef.current) {
          clearInterval(calSchedulerTimerRef.current)
          calSchedulerTimerRef.current = null
        }
        patch({ calibrationRunning: false })
      }
    },
    [patch],
  )

  const calScheduleTick = useCallback(() => {
    const ctx = audioCtxRef.current
    const lookahead = 0.12
    let guard = 0
    while (calNextTimeRef.current < ctx.currentTime + lookahead && guard < 32) {
      calScheduleOneBeat(calNextTimeRef.current)
      guard++
    }
  }, [calScheduleOneBeat])

  const startCalibrationSequence = useCallback(() => {
    const ctx = ensureAudioCtx()
    calBeatIndexRef.current = 0
    calScheduledBeatTimesRef.current = []
    calDeltasRef.current = []
    calNextTimeRef.current = ctx.currentTime + 0.12
    patch({ calibrationRunning: true, calibrationInTapPhase: false, calibrationTapsCollected: 0, calibrationResultMs: null })
    calSchedulerTimerRef.current = setInterval(calScheduleTick, 25)
  }, [ensureAudioCtx, patch, calScheduleTick])

  const openCalibration = useCallback(() => {
    if (stateRef.current.isPlaying) stopPlayback()
    patch({ calibrationOpen: true, calibrationRunning: false, calibrationInTapPhase: false, calibrationTapsCollected: 0, calibrationResultMs: null })
    startCalibrationSequence()
  }, [patch, stopPlayback, startCalibrationSequence])

  const closeCalibration = useCallback(() => {
    if (calSchedulerTimerRef.current) {
      clearInterval(calSchedulerTimerRef.current)
      calSchedulerTimerRef.current = null
    }
    patch({ calibrationOpen: false, calibrationRunning: false })
  }, [patch])

  const registerCalibrationTap = useCallback(() => {
    // Deliberately NOT gated on calibrationRunning: the click sequence can
    // finish playing before the user gets their 8th tap in, and that last
    // tap should still count against the final scheduled beat.
    if (calScheduledBeatTimesRef.current.length === 0 || calDeltasRef.current.length >= 8) return
    const ctx = audioCtxRef.current
    const now = ctx.currentTime
    let bestDelta = Infinity
    let nearestTime = null
    for (const t of calScheduledBeatTimesRef.current) {
      const d = Math.abs(t - now)
      if (d < bestDelta) {
        bestDelta = d
        nearestTime = t
      }
    }
    if (nearestTime === null) return
    const deltaMs = (now - nearestTime) * 1000
    calDeltasRef.current.push(deltaMs)
    const collected = calDeltasRef.current.length
    patch({ calibrationTapsCollected: collected })
    if (collected >= 8) {
      const avg = calDeltasRef.current.reduce((a, b) => a + b, 0) / calDeltasRef.current.length
      const rounded = Math.round(avg)
      if (calSchedulerTimerRef.current) {
        clearInterval(calSchedulerTimerRef.current)
        calSchedulerTimerRef.current = null
      }
      patch({ offsetMs: Math.max(-300, Math.min(300, rounded)), calibrationResultMs: rounded, calibrationRunning: false })
    }
  }, [patch])

  // ---- keyboard input (desktop) ----
  const handleKeyDown = useCallback(
    (e) => {
      const key = (e.key || '').toUpperCase()
      if (!key) return
      const s = stateRef.current
      if (s.rebindingAction) {
        patch((prev) => ({
          keyBinds: { ...prev.keyBinds, [prev.rebindingAction]: key },
          rebindingAction: null,
        }))
        return
      }
      const tag = e.target && e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return

      // While the calibration modal is open, X is its tap trigger instead
      // of tap-tempo / pattern judging — this is the whole reason it needs
      // to accept keyboard taps at all: calibrating with a mouse click
      // wouldn't measure the same input path a keyboard player actually uses.
      if (s.calibrationOpen) {
        if (key === 'X') registerCalibrationTap()
        return
      }

      // Same idea for the tap-tempo UI: X only means "tap" while it's open,
      // so it's free to also be bound as a regular L/R/pad key otherwise.
      if (s.tapTempoOpen) {
        if (key === 'X') registerTapTempoTap()
        return
      }

      const b = s.keyBinds
      let padId = null
      if (key === b.L) padId = 'L'
      else if (key === b.R) padId = 'R'
      else if (key === b.L1) padId = 'L1'
      else if (key === b.R1) padId = 'R1'
      else if (key === b.L2) padId = 'L2'
      else if (key === b.R2) padId = 'R2'
      if (padId) registerJudgedTap(padId)
    },
    [patch, registerTapTempoTap, registerJudgedTap, registerCalibrationTap],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current)
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
      if (calSchedulerTimerRef.current) clearInterval(calSchedulerTimerRef.current)
      if (missedIndexTimerRef.current) clearTimeout(missedIndexTimerRef.current)
      if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current)
    }
  }, [handleKeyDown])

  return {
    state,
    scheduledEventsRef,
    handleBpmInput,
    handleLeadInInput,
    handleRampAmountInput,
    handleRampIntervalInput,
    handleOffsetInput,
    handleMetronomeVolumeInput,
    handleHitSoundVolumeInput,
    handleGuideVolumeInput,
    openTapTempo,
    closeTapTempo,
    registerTapTempoTap,
    setStatic,
    setProgrammed,
    setRampRep,
    setRampTime,
    setTapMode,
    selectPattern,
    toggleMirror,
    toggleAccent,
    toggleGuide,
    toggleHitSound,
    toggleShowTargetPad,
    setJudgementMode,
    resetJudgementCounts,
    startRebind,
    cancelRebind,
    registerJudgedTap,
    togglePlay,
    openCalibration,
    closeCalibration,
    registerCalibrationTap,
  }
}
