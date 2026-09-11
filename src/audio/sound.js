// Pure Web Audio synthesis helpers — synthesized placeholder tones, used as
// a fallback wherever a named sample isn't available yet. Every call
// schedules a short percussive envelope at an exact AudioContext time so
// playback stays sample-accurate regardless of JS main-thread timing jitter.
// Every play*() function takes a trailing `volume` multiplier (default 1)
// so the per-category volume sliders in Settings can scale it.

// Every voice routes through one shared limiter on the way to the speakers
// (like a DAW's master bus) instead of straight to ctx.destination — full,
// untruncated polyphonic playback (every tap plays its whole sample,
// however many overlap) is exactly what a real sampler/DAW does; what a
// mixing console adds on top is gain-staging so that overlap never turns
// into harsh digital clipping. A DynamicsCompressorNode set up as a brick-
// wall-ish limiter is the Web Audio equivalent. One per AudioContext.
const masterBusCache = new WeakMap()
function getMasterBus(ctx) {
  let bus = masterBusCache.get(ctx)
  if (!bus) {
    bus = ctx.createDynamicsCompressor()
    bus.threshold.setValueAtTime(-6, ctx.currentTime)
    bus.knee.setValueAtTime(6, ctx.currentTime)
    bus.ratio.setValueAtTime(16, ctx.currentTime)
    bus.attack.setValueAtTime(0.003, ctx.currentTime)
    bus.release.setValueAtTime(0.15, ctx.currentTime)
    bus.connect(ctx.destination)
    masterBusCache.set(ctx, bus)
  }
  return bus
}

export function playTone(ctx, time, freq, duration, gainPeak, type) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type || 'sine'
  osc.frequency.setValueAtTime(freq, time)
  gain.gain.setValueAtTime(0.0001, time)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainPeak), time + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, time + duration)
  osc.connect(gain)
  gain.connect(getMasterBus(ctx))
  osc.start(time)
  osc.stop(time + duration + 0.02)
}

export function playClick(ctx, time, accented, volume = 1) {
  if (accented) playTone(ctx, time, 1600, 0.055, 0.35 * volume, 'square')
  else playTone(ctx, time, 1000, 0.045, 0.22 * volume, 'square')
}

export function playGuide(ctx, time, hand, volume = 1) {
  if (hand === 'L') playTone(ctx, time, 440, 0.05, 0.16 * volume, 'triangle')
  else playTone(ctx, time, 660, 0.05, 0.16 * volume, 'triangle')
}

// ---------------------------------------------------------------------
// Named sample playback (se_game_answer / se_game_great / se_game_good /
// se_game_click), with a graceful fallback to a synthesized tone when the
// file isn't present. Drop files into public/sounds/<name>.{mp3,wav,ogg}
// and they're picked up automatically — no code changes needed.
// ---------------------------------------------------------------------

const SAMPLE_FILES = {
  answer: 'se_game_answer', // Critical Perfect + Perfect share this sound
  great: 'se_game_great',
  good: 'se_game_good',
  click: 'se_game_click', // count-in / lead-in beats
}
const EXTENSIONS = ['mp3', 'wav', 'ogg']

// key -> AudioBuffer | null (null = looked for it, not found — stop trying)
const bufferCache = new Map()
const loadingCache = new Map()

async function tryLoad(ctx, fileBase, extIndex = 0) {
  if (extIndex >= EXTENSIONS.length) return null
  try {
    // BASE_URL (not a hardcoded leading "/") so this still resolves once the
    // app is deployed under a subpath, e.g. GitHub Pages at /rhythm-trainer/.
    const res = await fetch(`${import.meta.env.BASE_URL}sounds/${fileBase}.${EXTENSIONS[extIndex]}`)
    if (!res.ok) return tryLoad(ctx, fileBase, extIndex + 1)
    const arrayBuffer = await res.arrayBuffer()
    return await ctx.decodeAudioData(arrayBuffer)
  } catch {
    return tryLoad(ctx, fileBase, extIndex + 1)
  }
}

function loadSample(ctx, key) {
  if (bufferCache.has(key)) return
  if (loadingCache.has(key)) return
  const fileBase = SAMPLE_FILES[key]
  const promise = tryLoad(ctx, fileBase).then((buffer) => {
    bufferCache.set(key, buffer) // buffer may be null — that's fine, means "use fallback"
    loadingCache.delete(key)
  })
  loadingCache.set(key, promise)
}

// Kick off loading every named sample as soon as an AudioContext exists,
// so playback almost never has to wait on a network fetch mid-tap.
export function preloadSamples(ctx) {
  Object.keys(SAMPLE_FILES).forEach((key) => loadSample(ctx, key))
}

// These samples run 350-875ms — long enough that fast tapping stacks
// several full, overlapping copies of the same sample at once. Desktop has
// DSP headroom to spare for that; phones commonly don't, and piling up
// unbounded simultaneous voices through one shared compressor is exactly
// the kind of real-time load that produces audible clipping/glitching on
// mobile hardware (never showing up on desktop, same code) — and can burn
// enough CPU on the audio thread to start contending with input handling
// too. Cap how many of these can ring out at once; past the cap, stop the
// OLDEST voice before starting the new one. A single tap or a normal roll
// (a few overlapping hits) is never touched — full, untruncated sample,
// exactly as before. Only pathological pile-ups get capped, and those
// extra copies are already inaudibly masked under the rest of the stack
// anyway, so nothing perceptible is lost in the common case.
const MAX_CONCURRENT_SAMPLE_VOICES = 4
let activeSampleVoices = []

function playBuffer(ctx, buffer, time, gain) {
  const source = ctx.createBufferSource()
  const g = ctx.createGain()
  g.gain.setValueAtTime(Math.max(0, gain), time)
  source.buffer = buffer
  source.connect(g)
  // Full, untruncated playback every time, straight through the shared
  // limiter — as many overlapping copies as get triggered, exactly like a
  // real sampler/DAW; the limiter (not truncation) is what keeps that from
  // ever turning into harsh clipping.
  g.connect(getMasterBus(ctx))

  activeSampleVoices.push(source)
  if (activeSampleVoices.length > MAX_CONCURRENT_SAMPLE_VOICES) {
    const oldest = activeSampleVoices.shift()
    try {
      oldest.stop()
    } catch {
      // Already stopped/ended on its own between the push and here — fine.
    }
  }

  // Explicitly release the nodes once playback ends instead of leaving it
  // to garbage collection — cheap insurance against ever accumulating
  // enough dead nodes in a long session to matter on a low-power device.
  source.onended = () => {
    source.disconnect()
    g.disconnect()
    activeSampleVoices = activeSampleVoices.filter((s) => s !== source)
  }
  source.start(time)
}

// Plays the named sample if it's already loaded; otherwise triggers the
// fallback synthesized tone this time (and the sample, once it finishes
// loading, is cached for every call after).
function playSampleOrFallback(ctx, key, time, gain, fallback) {
  const cached = bufferCache.get(key)
  if (cached) {
    playBuffer(ctx, cached, time, gain)
    return
  }
  if (!bufferCache.has(key)) loadSample(ctx, key)
  fallback()
}

// Every other sound in this app (metronome, guide, count-in) is triggered
// from the lookahead scheduler, so it's always requested well ahead of
// ctx.currentTime and lands exactly on schedule. The hit sound is the one
// exception — it's reactive, requested at essentially ctx.currentTime the
// instant a tap is judged, because there's no way to know in advance when
// the player will tap. Asking Web Audio to start a sound AT (or behind)
// currentTime forces it to snap forward to the nearest audio-callback
// boundary it can still hit, and that snap distance isn't fixed — it's
// however far the request happened to land from that boundary, which
// varies call to call. Desktop callback periods are small enough (a few
// ms) that this is inaudible; mobile devices commonly run much larger
// callback/buffer periods, so the same pattern produces clearly uneven
// timing between taps even when the taps themselves were perfectly even.
// A small fixed lookahead gives the audio thread a stable target instead
// of a moving one, at the cost of a small constant (not random) delay
// between the physical tap and hearing its confirmation.
const HIT_SOUND_LOOKAHEAD_SEC = 0.03

// Judgement feedback. Critical Perfect and Perfect intentionally share one
// sound (se_game_answer) — the footer still counts them separately, only
// the audio is merged. Base levels are tuned quieter than the metronome
// click (which peaks at 0.35); `volume` layers the user's slider on top.
export function playHitSound(ctx, time, tier, volume = 1) {
  const t = time + HIT_SOUND_LOOKAHEAD_SEC
  if (tier === 'critical' || tier === 'perfect' || tier === 'idle') {
    playSampleOrFallback(ctx, 'answer', t, 0.5 * volume, () => {
      playTone(ctx, t, 1500, 0.06, 0.16 * volume, 'sine')
    })
  } else if (tier === 'great') {
    playSampleOrFallback(ctx, 'great', t, 0.5 * volume, () => {
      playTone(ctx, t, 1000, 0.06, 0.14 * volume, 'triangle')
    })
  } else if (tier === 'good') {
    playSampleOrFallback(ctx, 'good', t, 0.5 * volume, () => {
      playTone(ctx, t, 700, 0.07, 0.12 * volume, 'triangle')
    })
  } else {
    // Miss has no named sample in this request — keep the synthesized buzz.
    playTone(ctx, t, 220, 0.12, 0.18 * volume, 'sawtooth')
  }
}

// Count-in / lead-in beat click (se_game_click). Accent still distinguishes
// beat 1 of a bar — via sample gain when the sample is loaded, via the
// existing pitch-based accent when falling back to the synthesized click.
export function playLeadInClick(ctx, time, accented, volume = 1) {
  playSampleOrFallback(ctx, 'click', time, (accented ? 0.6 : 0.4) * volume, () => {
    playClick(ctx, time, accented, volume)
  })
}
