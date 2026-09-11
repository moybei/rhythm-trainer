import { useCallback, useEffect, useRef, useState } from 'react'
import { currentPattern, flattenPattern, DEFAULT_KEYBINDS, handForPad, padsForHand } from '../data/patterns.js'
import { playClick, playGuide, playHitSound, playLeadInClick, preloadSamples } from '../audio/sound.js'
import { createAudioClock } from '../audio/clock.js'
import { createTapTimestampRepair } from '../utils/tapTimestampRepair.js'

// A note stays judgeable for this long on either side of its scheduled
// time — the same window as the Good tier's outer edge. Once it closes
// without a correct-hand tap, the note auto-resolves to a Miss.
const GOOD_WINDOW_MS = 150
const GOOD_WINDOW_SEC = GOOD_WINDOW_MS / 1000

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
  missedIndices: [], // hit indices missed so far *this loop* — reset at each rep boundary
  tapFeedback: null, // { targets: [padId,...], tier, direction: 'fast' | 'late' | null, seq } — transient, not persisted

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
  missSoundVolume: 1,
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
  'missSoundVolume',
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
  const scheduledEventsRef = useRef([]) // [{time, rowIndex, hand, judged}]
  const currentHitsRef = useRef([])
  const lastPatternIdRef = useRef(null)
  const missedIndicesRef = useRef(new Set()) // hit indices missed so far this loop
  const lastActiveRepRef = useRef(0) // which lap through the pattern the display has cleared missed-marks for
  const tapFeedbackSeqRef = useRef(0)
  const tapFeedbackTimerRef = useRef(null)
  const leadinFlashSeqRef = useRef(0)

  // Last few judged taps, for the ?debugTap=1 overlay: the event's own
  // timestamp, how late our handler ran behind it, and the absolute audio
  // time its sound was scheduled at. Comparing the gaps between the first
  // and the last column is what separates an input-timing problem from an
  // output-scheduling one — the two look identical from the player's side.
  const tapDebugRef = useRef([])
  // Monotonic count of taps the engine actually accepted, so the overlay
  // can compare it against how many touches the digitiser reported and
  // show whether anything is being lost on the way in.
  const judgedTapCountRef = useRef(0)

  const calSchedulerTimerRef = useRef(null)
  const calNextTimeRef = useRef(0)
  const calBeatIndexRef = useRef(0)
  const calScheduledBeatTimesRef = useRef([])
  const calDeltasRef = useRef([])

  // Continuously-filtered performance.now() <-> AudioContext.currentTime
  // bridge, so an event's `timeStamp` (same clock as performance.now()) can
  // be converted into audio-clock time. That lets judgement use the moment
  // the browser actually received the input event instead of the moment our
  // JS callback happened to run, and lets a tap's own confirmation sound be
  // scheduled off that same instant. See audio/clock.js for why a single
  // {performance.now(), ctx.currentTime} pair is not good enough for either
  // job on a device with a large audio buffer.
  const clockRef = useRef(null)

  // Every judged or calibration tap goes through here first, so a
  // timestamp iOS collapsed onto the previous tap's gets rebuilt before
  // anything is scored against it. One shared instance across pads and
  // keys, because a delivery stall collapses whatever it happens to be
  // carrying, not one particular pad.
  const repairTapTimeRef = useRef(null)
  if (repairTapTimeRef.current === null) repairTapTimeRef.current = createTapTimestampRepair()
  const repairTapTime = useCallback((eventTimeStamp) => {
    const clock = clockRef.current
    if (!clock || eventTimeStamp == null) return eventTimeStamp
    return repairTapTimeRef.current(eventTimeStamp, clock.typicalHandlerDelaySec() * 1000)
  }, [])

  const ensureAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || window.webkitAudioContext
      // 'interactive' asks the browser for the lowest latency it can offer
      // (smaller internal buffers) rather than the power-saving default —
      // the same trade-off a real rhythm game's audio engine makes.
      audioCtxRef.current = new AC({ latencyHint: 'interactive' })
      preloadSamples(audioCtxRef.current)
      clockRef.current = createAudioClock(audioCtxRef.current)
      // Mobile browsers (iOS especially) can suspend the context the moment
      // the tab/app is backgrounded even briefly — a screen lock or app
      // switch mid-session. Resume the instant it's visible again instead
      // of waiting for the next tap to notice and pay the resume() latency
      // right when the player is trying to play.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
          audioCtxRef.current.resume().then(() => clockRef.current && clockRef.current.reset())
        }
      })
    }
    if (audioCtxRef.current.state === 'suspended') {
      // currentTime stands still while suspended but performance.now()
      // doesn't, so everything the clock learned before the gap is now
      // wrong — throw it away once the context is actually running again.
      audioCtxRef.current.resume().then(() => clockRef.current && clockRef.current.reset())
    }
    return audioCtxRef.current
  }, [])

  // Audio-clock time of an input event, from its own timestamp. Falls back
  // to "right now" (still the filtered estimate, never the quantised
  // ctx.currentTime) when an event didn't carry a usable one.
  const perfToAudioTime = useCallback((perfTimeStamp) => {
    const clock = clockRef.current
    if (!clock) return audioCtxRef.current ? audioCtxRef.current.currentTime : 0
    return perfTimeStamp != null ? clock.perfToAudio(perfTimeStamp) : clock.now()
  }, [])

  // Red "missed" note coloring accumulates over one loop of the pattern and
  // resets at the next rep boundary (see scheduleOneEvent) — also reset
  // explicitly on pattern switch, playback start/stop, and a manual count
  // reset, so stale red marks never linger from a different pattern or run.
  const clearMissedIndices = useCallback(() => {
    missedIndicesRef.current.clear()
    patch({ missedIndices: [] })
  }, [patch])

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
  // Separate from hitSoundVolume so Miss can be dragged to 0% (muted)
  // independently of the Critical/Perfect/Great/Good hit sounds.
  const handleMissSoundVolumeInput = useCallback(
    (e) => {
      const v = parseInt(e.target.value, 10)
      if (!Number.isNaN(v)) patch({ missSoundVolume: Math.max(0, Math.min(150, v)) / 100 })
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

  const registerTapTempoTap = useCallback((eventTimeStamp) => {
    // Prefer the input event's own timestamp over "whenever this callback
    // happened to run" — same reasoning as registerJudgedTap: on a loaded
    // main thread (or over the touch pipeline's own latency) those can
    // drift apart by enough to jitter the measured interval between taps.
    const now =
      eventTimeStamp != null ? eventTimeStamp : typeof performance !== 'undefined' ? performance.now() : Date.now()
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
  const selectPattern = useCallback(
    (id) => {
      clearMissedIndices()
      patch({ selectedPatternId: id })
    },
    [patch, clearMissedIndices],
  )
  const toggleMirror = useCallback(() => patch((prev) => ({ mirrored: !prev.mirrored })), [patch])
  const toggleAccent = useCallback(() => patch((prev) => ({ accentEnabled: !prev.accentEnabled })), [patch])
  const toggleGuide = useCallback(() => patch((prev) => ({ guideEnabled: !prev.guideEnabled })), [patch])
  const toggleHitSound = useCallback(() => patch((prev) => ({ hitSoundEnabled: !prev.hitSoundEnabled })), [patch])
  const toggleShowTargetPad = useCallback(
    () => patch((prev) => ({ showTargetPad: !prev.showTargetPad })),
    [patch],
  )
  const setJudgementMode = useCallback((mode) => patch({ judgementMode: mode }), [patch])
  const resetJudgementCounts = useCallback(() => {
    clearMissedIndices()
    patch({ judgementCounts: { critical: 0, perfect: 0, great: 0, good: 0, miss: 0 } })
  }, [patch, clearMissedIndices])
  const startRebind = useCallback((action) => patch({ rebindingAction: action }), [patch])
  const cancelRebind = useCallback(() => patch({ rebindingAction: null }), [patch])

  // Shows a FAST/LATE(+tier) or Miss badge on every pad id in `targets` —
  // the exact tapped pad for a real tap, or every pad representing a hand
  // for an auto-miss timeout (no tap to anchor to). Re-keyed each call so
  // the CSS fade-in restarts even if the same badge repeats back-to-back.
  const showTapFeedback = useCallback(
    (targets, tier, direction) => {
      if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current)
      tapFeedbackSeqRef.current += 1
      const seq = tapFeedbackSeqRef.current
      patch({ tapFeedback: { targets, tier, direction, seq } })
      tapFeedbackTimerRef.current = setTimeout(() => {
        patch((prev) => (prev.tapFeedback && prev.tapFeedback.seq === seq ? { tapFeedback: null } : {}))
      }, 600)
    },
    [patch],
  )

  // ---- judged tap (real-time, maimai-style windows) ----
  // `padId` (one of 'L' | 'R' | 'L1' | 'R1' | 'L2' | 'R2') identifies which
  // button/key triggered this tap. L and R are independent judgement lanes,
  // like a real rhythm game: a tap only ever competes against *that same
  // hand's* unjudged notes, never the other hand's — so at fast 16th notes,
  // where an L and the next R can be closer together than the judge window
  // is wide, an R tap can't accidentally get pulled onto a nearby L (or vice
  // versa) just because that L happened to be a few ms closer in time.
  //
  // Within one hand's lane, a tap matches the EARLIEST still-open note for
  // that hand (not whichever is numerically closest) — scheduledEventsRef is
  // already time-ordered, so this is just "first unjudged, in-window match".
  // That keeps consecutive same-hand notes (a double stroke's RR, LL, ...)
  // judged one-for-one in the order they're actually struck, instead of a
  // late first tap potentially jumping ahead to score against the *second*
  // note while leaving the first to time out as a Miss.
  //
  // Either way, each note is judged (or auto-missed) exactly once: a tap
  // only ever matches a note that's both unjudged and still inside its own
  // active window, so a stray tap can't reach back and "steal" a judgement
  // from a note it wasn't actually near.
  const registerJudgedTap = useCallback(
    (padId, eventTimeStamp) => {
      const s = stateRef.current
      const ctx = ensureAudioCtx()
      eventTimeStamp = repairTapTime(eventTimeStamp)
      // The confirmation sound is scheduled a fixed interval after THIS
      // TAP — derived from the tap's own event timestamp, not from a fresh
      // ctx.currentTime read. Reading the clock here felt like the most
      // direct, lowest-latency thing to do, and on desktop it is; but
      // ctx.currentTime only advances one audio block at a time, so on a
      // device with a big audio buffer it reports the last block boundary
      // rather than "now", rounding every tap down by a different amount.
      // Evenly spaced taps then come out snapped to the block grid —
      // audibly uneven, which is precisely the iPhone symptom. Anchoring
      // to the tap instead makes the tap-to-sound delay a constant, which
      // is what "even" actually requires. See audio/clock.js.
      const soundTime = clockRef.current.reactionTime(eventTimeStamp)
      judgedTapCountRef.current++
      tapDebugRef.current.push({
        padId,
        eventMs: eventTimeStamp,
        handlerAgeMs: eventTimeStamp != null ? performance.now() - eventTimeStamp : null,
        soundTimeMs: soundTime * 1000,
      })
      if (tapDebugRef.current.length > 32) tapDebugRef.current.shift()

      // Judgement (tier/FAST-LATE) uses the same mapped timestamp, since
      // it's compared against precisely scheduled note times — using
      // "whenever this callback happened to run" instead would register as
      // extra, inconsistent input jitter in the score.
      const rawNow = perfToAudioTime(eventTimeStamp)

      if (!s.isPlaying || scheduledEventsRef.current.length === 0) {
        // Nothing playing to judge against — still confirm the pad/key works
        // with an audible hit sound (same sample as a Perfect hit), just with
        // no tier, no count, and no badge (nothing to be early or late
        // relative to).
        if (s.hitSoundEnabled) playHitSound(ctx, soundTime, 'idle', s.hitSoundVolume)
        return
      }
      const now = rawNow - s.offsetMs / 1000
      const tappedHand = handForPad(padId)

      let nearest = null
      for (const ev of scheduledEventsRef.current) {
        if (ev.judged || ev.hand !== tappedHand) continue
        if (Math.abs(ev.time - now) > GOOD_WINDOW_SEC) continue // outside this note's active window — not a candidate
        nearest = ev
        break // earliest unjudged, in-window note for this hand — preserves tap order
      }

      if (!nearest) {
        // No open same-hand note within reach — a stray tap (including
        // tapping a hand nothing is currently due for). Still responsive,
        // but nothing to judge (matches the "not playing" fallback above).
        if (s.hitSoundEnabled) playHitSound(ctx, soundTime, 'idle', s.hitSoundVolume)
        return
      }

      const signed = nearest.time - now // positive: beat is still ahead (tap was early/FAST); negative: beat already passed (tap was LATE)
      const deltaMs = Math.abs(signed) * 1000
      let tier
      if (deltaMs <= 16.66) tier = 'critical'
      else if (deltaMs <= 50) tier = 'perfect'
      else if (deltaMs <= 100) tier = 'great'
      else tier = 'good' // candidates are pre-filtered to <= GOOD_WINDOW_MS above

      nearest.judged = true
      if (s.hitSoundEnabled) playHitSound(ctx, soundTime, tier, s.hitSoundVolume)

      // Critical Perfect is treated as "on time" — no badge at all.
      if (padId && tier !== 'critical') {
        const direction = signed > 0 ? 'fast' : 'late'
        showTapFeedback([padId], tier, direction)
      }

      patch((prev) => ({
        judgementCounts: { ...prev.judgementCounts, [tier]: prev.judgementCounts[tier] + 1 },
      }))
    },
    [patch, ensureAudioCtx, perfToAudioTime, showTapFeedback, repairTapTime],
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
          // hitCounterRef resetting to 0 means the next hit's `rep` also
          // starts over at 0 (see scheduleOneEvent below) — follow suit here
          // so a post-ramp restart doesn't leave lastActiveRepRef stranded
          // at whatever (larger) lap number play had reached pre-ramp, which
          // would otherwise stop the loop-boundary clear from ever firing
          // again. Also clear any marks left over from before the ramp.
          lastActiveRepRef.current = 0
          if (missedIndicesRef.current.size > 0) missedIndicesRef.current.clear()
          patch({ inLeadin: false, bpm: Math.round(currentBpmRef.current), missedIndices: [] })
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
      const rep = Math.floor(hitCounterRef.current / total) // which lap through the pattern this hit belongs to
      // (The "new loop started, clear red missed marks" reset lives in
      // updateHighlight, not here — see there for why.)
      scheduledEventsRef.current.push({ time, rowIndex, hand, judged: false, rep })
      // Only ever trim already-resolved (judged) events off the front — an
      // unjudged one hasn't been through the auto-miss sweep yet, and
      // discarding it here would silently drop that note's miss instead of
      // ever counting it.
      while (scheduledEventsRef.current.length > 96 && scheduledEventsRef.current[0].judged) {
        scheduledEventsRef.current.shift()
      }

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
    const ctx = audioCtxRef.current
    // The filtered estimate, not ctx.currentTime: the auto-miss sweep
    // compares against the same note times judged taps do, so both sides
    // have to read the clock the same way or a note can be swept as a Miss
    // while a tap arriving at that very instant still measures as in-window.
    const now = clockRef.current.now()
    const s = stateRef.current

    // Auto-miss sweep: any note whose window has fully closed without a
    // correct-hand tap resolves to a Miss on its own — this is what makes
    // simply not tapping anything reliably score Miss/Miss/Miss instead of
    // silently doing nothing.
    let missCount = 0
    let lastMissedHand = null
    for (const ev of scheduledEventsRef.current) {
      if (!ev.judged && now - ev.time > GOOD_WINDOW_SEC) {
        ev.judged = true
        missedIndicesRef.current.add(ev.rowIndex)
        missCount++
        lastMissedHand = ev.hand
      }
    }

    let idx = -1
    let repAtIdx = -1
    for (let i = scheduledEventsRef.current.length - 1; i >= 0; i--) {
      if (scheduledEventsRef.current[i].time <= now) {
        idx = scheduledEventsRef.current[i].rowIndex
        repAtIdx = scheduledEventsRef.current[i].rep
        break
      }
    }

    // A later lap than the one we last cleared for means a new loop through
    // the pattern has started — clear last loop's red "missed" marks right
    // here, in the same place misses get added, so the two can never race
    // against each other (they used to live in different functions —
    // scheduling vs. this rAF loop — which could interleave unpredictably).
    // Comparing lap NUMBERS (not "did the index decrease") also survives a
    // big catch-up jump spanning more than one full lap in a single frame
    // (e.g. after the tab was backgrounded) without misfiring or missing it.
    const looped = repAtIdx !== -1 && repAtIdx > lastActiveRepRef.current
    if (looped) {
      missedIndicesRef.current.clear()
      lastActiveRepRef.current = repAtIdx
    }

    if (missCount > 0) {
      // reactionTime(null) rather than `now`: playHitSound no longer adds
      // any lookahead of its own, and a sound asked for at the current
      // instant is already inside the block being rendered.
      if (s.hitSoundEnabled) playHitSound(ctx, clockRef.current.reactionTime(null), 'miss', s.missSoundVolume)
      if (lastMissedHand) showTapFeedback(padsForHand(lastMissedHand), 'miss', null)
    }

    if (missCount > 0 || looped || idx !== s.activeIndex) {
      patch((prev) => ({
        ...(missCount > 0 && { judgementCounts: { ...prev.judgementCounts, miss: prev.judgementCounts.miss + missCount } }),
        ...((missCount > 0 || looped) && { missedIndices: Array.from(missedIndicesRef.current) }),
        ...(idx !== s.activeIndex && { activeIndex: idx }),
      }))
    }
    rafIdRef.current = requestAnimationFrame(updateHighlight)
  }, [patch, showTapFeedback])

  const startPlayback = useCallback(() => {
    const ctx = ensureAudioCtx()
    // No re-anchoring needed here any more: the clock bridge samples both
    // clocks continuously over a sliding window, so the slow drift between
    // the CPU timer and the audio device's own oscillator gets tracked as
    // it happens instead of being reset once per play session.
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
    missedIndicesRef.current.clear()
    lastActiveRepRef.current = 0
    patch({
      isPlaying: true,
      activeIndex: -1,
      inLeadin: phaseRef.current === 'leadin',
      leadinCount: leadBeatsRemainingRef.current,
      leadInTotal: leadBeatsRemainingRef.current,
      targetBpm: Math.round(currentBpmRef.current),
      missedIndices: [],
    })
    schedulerTimerRef.current = setInterval(scheduleTick, 25)
    rafIdRef.current = requestAnimationFrame(updateHighlight)
  }, [ensureAudioCtx, patch, scheduleTick, updateHighlight])

  const stopPlayback = useCallback(() => {
    if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current)
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current)
    schedulerTimerRef.current = null
    rafIdRef.current = null
    missedIndicesRef.current.clear()
    patch({ isPlaying: false, activeIndex: -1, inLeadin: false, missedIndices: [] })
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

  const registerCalibrationTap = useCallback((eventTimeStamp) => {
    // Deliberately NOT gated on calibrationRunning: the click sequence can
    // finish playing before the user gets their 8th tap in, and that last
    // tap should still count against the final scheduled beat.
    if (calScheduledBeatTimesRef.current.length === 0 || calDeltasRef.current.length >= 8) return
    // Same audio-clock-mapped timestamp as registerJudgedTap, so the offset
    // this measures matches what future taps will actually be judged
    // against (otherwise calibration would bake in a slightly different
    // jitter profile than real play).
    const now = perfToAudioTime(repairTapTime(eventTimeStamp))
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
  }, [patch, perfToAudioTime, repairTapTime])

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
        if (key === 'X') registerCalibrationTap(e.timeStamp)
        return
      }

      // Same idea for the tap-tempo UI: X only means "tap" while it's open,
      // so it's free to also be bound as a regular L/R/pad key otherwise.
      if (s.tapTempoOpen) {
        if (key === 'X') registerTapTempoTap(e.timeStamp)
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
      if (padId) registerJudgedTap(padId, e.timeStamp)
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
      if (tapFeedbackTimerRef.current) clearTimeout(tapFeedbackTimerRef.current)
    }
  }, [handleKeyDown])

  const getClockStats = useCallback(() => (clockRef.current ? clockRef.current.stats() : null), [])

  return {
    state,
    scheduledEventsRef,
    tapDebugRef,
    judgedTapCountRef,
    getClockStats,
    handleBpmInput,
    handleLeadInInput,
    handleRampAmountInput,
    handleRampIntervalInput,
    handleOffsetInput,
    handleMetronomeVolumeInput,
    handleHitSoundVolumeInput,
    handleMissSoundVolumeInput,
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
