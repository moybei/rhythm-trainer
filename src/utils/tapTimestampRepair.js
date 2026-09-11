// Repairs input timestamps that the OS handed over collapsed.
//
// Judgement lives or dies on event.timeStamp, and on iOS that is normally
// an excellent number: it comes from the digitiser, not from whenever the
// browser got around to dispatching, which is why measured tap gaps land
// on multiples of the 240Hz scan interval and why the ~31ms delivery
// delay shows up as a constant (which Calibrate removes) rather than as
// jitter.
//
// The exception is a stalled delivery. When iOS backs up and then hands
// over two touches together, both can carry the SAME timeStamp — observed
// on device as a pair whose event ages were 23ms and 106ms. The second
// tap is then judged as though it happened at the first one's instant,
// which at a 16.66ms Critical window is not a near miss, it's a wrong
// answer. Roughly 3% of taps in the readouts so far.
//
// Two accepted taps can never have a non-increasing hardware timestamp,
// so that condition alone identifies the damage. What it cannot identify
// on its own is a genuine unison hit — both hands landing together, which
// is real drumming and really does share one timestamp. Those arrive in
// the same dispatch, microseconds apart in our handler; a collapsed pair
// arrives tens of ms apart. Arrival gap separates them.
const COLLAPSE_MIN_ARRIVAL_GAP_MS = 15

// Once a timestamp is known bad, arrival time is the only evidence left.
// We know this device's typical delivery delay, so (arrival - typical) is
// a strictly better estimate than a value we have already proven wrong —
// and it is floored just past the previous tap, since whatever else is
// true, this tap came after that one.
export function createTapTimestampRepair() {
  let last = null // { eventMs, arrivalMs } — eventMs is the REPAIRED value

  return function repair(eventMs, typicalDelayMs) {
    if (eventMs == null || !Number.isFinite(eventMs)) return eventMs
    const arrivalMs = performance.now()
    let repaired = eventMs
    if (last && eventMs <= last.eventMs && arrivalMs - last.arrivalMs > COLLAPSE_MIN_ARRIVAL_GAP_MS) {
      repaired = Math.max(arrivalMs - typicalDelayMs, last.eventMs + 1)
      repairedCount++
    }
    last = { eventMs: repaired, arrivalMs }
    return repaired
  }
}

// Module-level so the ?debugTap=1 overlay can report it without the tap
// path having to carry a counter back up.
let repairedCount = 0
export function tapRepairStats() {
  return { repairedCount }
}
