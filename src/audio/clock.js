// A stable bridge between the two clocks this app has to reconcile:
// performance.now() (what every input event is timestamped in) and
// AudioContext.currentTime (what every sound is scheduled in).
//
// The trap: ctx.currentTime read from the main thread is NOT "now". The
// audio thread renders one whole block, advances currentTime by that
// block's duration, then sleeps until it's asked for the next one. So a
// main-thread read always returns the LAST block boundary — a value that
// is stale by anywhere from 0 to one full block period, by a different
// amount every single time you look.
//
// How much that matters is entirely a question of how big the block is,
// and that varies enormously by device — which is why `blockSec` below is
// measured rather than assumed. A small buffer (~3ms, which is what iOS
// Safari turned out to hand us on the iPhone this was first tested on,
// and what desktop Chrome gives) makes the error inaudible. A large one
// (some mobile browsers run 1024-2048 frames, i.e. 21-43ms) turns "play
// this at ctx.currentTime + k" into "quantise this onto the audio block
// grid": physically even taps come out snapped to that grid, audibly
// uneven. Adding a constant lookahead is no defence, because the
// quantisation is baked into the base value before the constant is added.
//
// So this is insurance against a class of device, not a fix for one
// specific symptom — don't reach for it to explain unevenness without
// checking the measured block period first.
//
// The same stale read also poisons judgement: anchoring perf->audio from
// a single {performance.now(), ctx.currentTime} pair bakes that one
// sample's staircase error in as a fixed offset for the whole session, so
// on a device with a large block period every tap can sit a full block
// away from where the player actually put it — wider than the entire
// Critical window, and a different amount each time playback starts.
//
// So: stop treating ctx.currentTime as "now". Keep a filtered affine map
// instead. offset = currentTime - perfNow/1000 is constant except for
// (a) the staircase, which can only ever make a reading too SMALL, and
// (b) genuine drift between the CPU timer and the audio device's own
// oscillator, which is real but slow (parts per million). So sample the
// pair continuously and take the MAXIMUM offset seen in a short sliding
// window: the largest sample is the one that happened to land closest to
// a block boundary, i.e. the one with the least staircase error, and the
// sliding window lets the estimate track real drift in both directions.
//
// A useful free by-product: since the staircase error spreads roughly
// uniformly over [0, blockPeriod), the SPREAD of offsets in that same
// window measures the block period itself — no extra sampling needed.
//
// The other half of this module's job has nothing to do with staircases:
// it owns how long after a tap that tap's sound is scheduled. That number
// is the difference between a rhythm trainer you can play and one you
// can't, so it's kept as small as the device's own input delivery allows
// and, above all, CONSTANT. See reactionTime() at the bottom.

// Deliberately not a neat divisor of any common block period, so samples
// walk across the staircase phase instead of locking onto one point of it.
const SAMPLE_INTERVAL_MS = 47
const ANCHOR_WINDOW_MS = 2000
// How far back to look for the worst input-handler delay seen recently.
// Long enough that the lookahead it feeds stays effectively constant
// across a roll — a lookahead that moved between taps would itself be
// audible as uneven spacing, the exact thing this module exists to fix.
const HANDLER_DELAY_WINDOW_MS = 3000

// Used until enough samples exist to measure the real one. Sized for a
// large mobile buffer rather than a small desktop one: guessing too big
// costs a few ms of constant latency, guessing too small costs the
// unevenness this whole module is about.
const ASSUMED_BLOCK_SEC = 0.025
const MIN_SAMPLES_FOR_BLOCK_ESTIMATE = 12
// No real audio buffer is bigger than this. Doubles as the stall
// detector threshold in takeSample(): a measured value past it is never
// a buffer, it is the audio clock having stopped for a while.
const MAX_MEASURED_BLOCK_SEC = 0.06

// Headroom baked into the tap-anchored lookahead. Deliberately larger
// than FLOOR_GUARD_SEC below, so the two are never in a photo finish: the
// floor is meant to be a rescue for a genuinely late handler, not
// something that trips on half of all taps and quietly takes scheduling
// back off the tap clock it was just moved onto.
const LOOKAHEAD_GUARD_SEC = 0.006
const FLOOR_GUARD_SEC = 0.002
const MIN_LOOKAHEAD_SEC = 0.012
// Most the lookahead may shrink per tap — see updateLookahead(). Sized
// against the fastest thing anyone plays here: at a 70ms roll this is a
// 2% nudge to one gap, under what the ear picks out of a steady sequence,
// while still unwinding a bad 60ms estimate inside a couple of seconds.
const LOOKAHEAD_DECAY_PER_TAP_SEC = 0.0015
const MAX_LOOKAHEAD_SEC = 0.08

// An event timestamp further than this from performance.now() isn't a
// DOMHighResTimeStamp on the same time origin (engines have shipped
// epoch-based timeStamps on touch events before). Rather than map a
// nonsense value into audio time, fall back to reading the clock here.
const MAX_PLAUSIBLE_EVENT_AGE_MS = 5000

export function createAudioClock(ctx) {
  // Sliding window of {perfMs, offsetSec} — see the max-filter note above.
  let samples = []
  let anchorOffsetSec = ctx.currentTime - performance.now() / 1000
  let blockSec = ASSUMED_BLOCK_SEC
  let handlerDelays = [] // {perfMs, delayMs} — how late our code ran vs. the event
  let clampCount = 0 // times a sound had to be pushed later than requested
  let scheduleCount = 0
  let schedulesSinceReset = 0
  let lastRawSample = null // previous {perfMs, audioSec}, for stall detection
  let timer = null

  function takeSample() {
    const perfMs = performance.now()
    // A context that isn't running has a frozen currentTime. Sampling it
    // would teach the filter that the two clocks are drifting apart at
    // 1:1 — the opposite of the truth — so sit those periods out.
    // currentTime === 0 is the giveaway for the other stall: a freshly
    // created context whose output device the OS has not finished opening
    // yet. It sits at exactly 0 for a few hundred ms while wall time runs
    // on, and sampling across that reads as a ~360ms "block period" — big
    // enough to pin the lookahead at its cap for the next eighty taps.
    // The coarse drift check below cannot catch it, because consecutive
    // samples inside the stall differ by only one sample interval.
    if (ctx.state !== 'running' || ctx.currentTime <= 0) {
      lastRawSample = null
      return
    }
    const audioSec = ctx.currentTime
    if (lastRawSample) {
      // Audio time advances one-for-one with wall time, give or take the
      // staircase at each end. A bigger discrepancy than any plausible
      // buffer means the audio clock STALLED rather than drifted: the
      // context was suspended, the tab was backgrounded, or — the case
      // that actually bit — the context was freshly created and its
      // currentTime sat at 0 for a few hundred ms while the OS opened the
      // output device. Every offset collected across a stall is wrong,
      // and worse, the spread of that window reads as a gigantic "block
      // period" (360ms was observed), which pins the lookahead at its cap
      // for the next eighty taps. Throw the window away instead.
      const dPerf = (perfMs - lastRawSample.perfMs) / 1000
      const dAudio = audioSec - lastRawSample.audioSec
      if (Math.abs(dAudio - dPerf) > MAX_MEASURED_BLOCK_SEC) samples = []
    }
    lastRawSample = { perfMs, audioSec }
    const offsetSec = audioSec - perfMs / 1000
    samples.push({ perfMs, offsetSec })
    const cutoff = perfMs - ANCHOR_WINDOW_MS
    if (samples.length > 4 && samples[0].perfMs < cutoff) {
      samples = samples.filter((s) => s.perfMs >= cutoff)
    }
    let max = -Infinity
    let min = Infinity
    for (const s of samples) {
      if (s.offsetSec > max) max = s.offsetSec
      if (s.offsetSec < min) min = s.offsetSec
    }
    anchorOffsetSec = max
    if (samples.length >= MIN_SAMPLES_FOR_BLOCK_ESTIMATE) {
      // baseLatency, where the browser reports it, is the authoritative
      // buffer size; the measured spread covers the case where it's
      // missing or understates what the device actually does.
      const reported = typeof ctx.baseLatency === 'number' && ctx.baseLatency > 0 ? ctx.baseLatency : 0
      blockSec = Math.min(MAX_MEASURED_BLOCK_SEC, Math.max(reported, max - min, 0.003))
    }
  }

  // Suspending the context freezes currentTime while performance.now()
  // keeps running, so every offset collected before the gap is now far too
  // large — and a max filter would happily hold that stale peak for a full
  // window. Throw the window away and start over on resume.
  function reset() {
    samples = []
    handlerDelays = []
    lastRawSample = null
    schedulesSinceReset = 0
    takeSample()
  }

  function recordHandlerDelay(perfMs, nowMs) {
    const delayMs = Math.max(0, nowMs - perfMs)
    handlerDelays.push({ perfMs: nowMs, delayMs })
    const cutoff = nowMs - HANDLER_DELAY_WINDOW_MS
    if (handlerDelays.length > 4 && handlerDelays[0].perfMs < cutoff) {
      handlerDelays = handlerDelays.filter((d) => d.perfMs >= cutoff)
    }
  }

  // A high percentile of recent handler delays, NOT the maximum.
  //
  // The lookahead has to exceed a tap's delivery age or that tap's sound
  // lands in the past and gets clamped. Sizing it off the worst age in the
  // window sounds safe, but it makes every tap pay for the unluckiest one:
  // a phone whose touches normally arrive 30ms late, with a single 98ms
  // straggler, ends up with a ~107ms lookahead — pinned at the cap — for
  // three full seconds. And it buys nothing, because a tap that genuinely
  // arrived 98ms late was going to be clamped whatever we did; the only
  // thing the extra headroom changes is that all 44 punctual taps around
  // it are delayed too. A percentile keeps the common case tight and
  // leaves the rare straggler to the floor clamp, which is exactly what
  // the floor is for.
  const DELAY_PERCENTILE = 0.9
  function handlerDelaySec() {
    if (handlerDelays.length === 0) return 0
    const sorted = handlerDelays.map((d) => d.delayMs).sort((a, b) => a - b)
    // With only a handful of samples this lands on (or very near) the max,
    // which is the right way to be wrong while there's little to go on.
    const idx = Math.ceil(DELAY_PERCENTILE * (sorted.length - 1))
    return sorted[idx] / 1000
  }

  function worstHandlerDelaySec() {
    let worst = 0
    for (const d of handlerDelays) if (d.delayMs > worst) worst = d.delayMs
    return worst / 1000
  }

  // The unquantised audio-clock time right now — what ctx.currentTime
  // would read if the audio thread updated it continuously instead of one
  // block at a time.
  function now() {
    return anchorOffsetSec + performance.now() / 1000
  }

  function usableEventTime(perfMs, nowMs) {
    return perfMs != null && Number.isFinite(perfMs) && Math.abs(nowMs - perfMs) <= MAX_PLAUSIBLE_EVENT_AGE_MS
  }

  function perfToAudio(perfMs) {
    const nowMs = performance.now()
    if (!usableEventTime(perfMs, nowMs)) return anchorOffsetSec + nowMs / 1000
    return anchorOffsetSec + perfMs / 1000
  }

  // How far after a tap that tap's own sound is scheduled. It has to clear
  // the audio block (a sound landing inside the block already being
  // rendered gets snapped forward to the next boundary — reintroducing
  // exactly the quantisation this module removes) plus however late our
  // handler actually ran. Self-tuning on both counts, so a fast device
  // pays a small constant latency and a slow one pays a larger constant
  // latency, and neither pays a VARYING one.
  //
  // The catch is that "self-tuning" and "constant" are in tension: the
  // moment a one-off stall (the first tap of a session pays for creating
  // the AudioContext and decoding samples) ages out of the delay window,
  // the target drops by however big that stall was, and THAT step lands
  // in the player's ears as one wrong-length gap. So the value is allowed
  // to rise instantly — safety — but may only fall by a sliver per tap.
  // Spread over dozens of taps, a recovery of even 60ms never exceeds the
  // ~1ms-per-gap the ear can pick out of a roll.
  let lookaheadSec = MIN_LOOKAHEAD_SEC
  function updateLookahead() {
    const target = Math.min(MAX_LOOKAHEAD_SEC, Math.max(MIN_LOOKAHEAD_SEC, blockSec + handlerDelaySec() + LOOKAHEAD_GUARD_SEC))
    if (target > lookaheadSec) lookaheadSec = target
    else lookaheadSec = Math.max(target, lookaheadSec - LOOKAHEAD_DECAY_PER_TAP_SEC)
    return lookaheadSec
  }
  function reactionLookaheadSec() {
    return lookaheadSec
  }

  // Absolute context time at which to schedule a sound that should be
  // heard a fixed interval after `eventPerfMs` (a tap). The floor is a
  // safety net only: if the handler ran so late that the ideal time is
  // already inside the block being rendered, push it to the next one
  // rather than let Web Audio snap it somewhere unpredictable.
  // `clampCount` counts how often that happens, since a high rate means
  // the lookahead is running too tight for this device.
  function reactionTime(eventPerfMs) {
    scheduleCount++
    // One clock reading for the whole call. Reading performance.now()
    // separately for the handler delay and for the floor would make the
    // floor fractionally newer than the delay it's compared against, which
    // is enough to trip the clamp on an otherwise perfectly punctual tap.
    const nowMs = performance.now()
    const usable = usableEventTime(eventPerfMs, nowMs)
    // The very first tap of a session is not representative of anything:
    // it's the one that creates the AudioContext, resumes it and kicks off
    // sample decoding, so its handler runs tens of ms late for reasons
    // that will never recur. Letting it into the window would hold the
    // lookahead — and so every later tap's latency — up at that one-off
    // figure while the ratchet slowly walked it back down.
    if (usable && schedulesSinceReset > 0) recordHandlerDelay(eventPerfMs, nowMs)
    schedulesSinceReset++
    const nowAudio = anchorOffsetSec + nowMs / 1000
    const base = usable ? anchorOffsetSec + eventPerfMs / 1000 : nowAudio
    const ideal = base + updateLookahead()
    const floor = nowAudio + blockSec + FLOOR_GUARD_SEC
    if (ideal < floor) {
      clampCount++
      return floor
    }
    return ideal
  }

  function stats() {
    return {
      blockMs: blockSec * 1000,
      lookaheadMs: reactionLookaheadSec() * 1000,
      handlerDelayMs: handlerDelaySec() * 1000,
      worstHandlerDelayMs: worstHandlerDelaySec() * 1000,
      sampleRate: ctx.sampleRate,
      baseLatencyMs: typeof ctx.baseLatency === 'number' ? ctx.baseLatency * 1000 : null,
      outputLatencyMs: typeof ctx.outputLatency === 'number' ? ctx.outputLatency * 1000 : null,
      clampCount,
      scheduleCount,
      sampleCount: samples.length,
    }
  }

  function dispose() {
    if (timer != null) clearInterval(timer)
    timer = null
  }

  takeSample()
  timer = setInterval(takeSample, SAMPLE_INTERVAL_MS)

  return { now, perfToAudio, reactionTime, reactionLookaheadSec, reset, stats, dispose }
}
