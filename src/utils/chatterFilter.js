// Rejects touchscreen "chatter": one hard, fast contact physically
// bouncing on the glass and getting sensed by the digitiser as two
// touch-down events a few milliseconds apart, the same phenomenon as
// mechanical switch bounce.
//
// No human can deliberately land two separate taps on the same pad closer
// together than this. 25ms is 40 taps per second on one hand, far past
// what anyone plays, so nothing real is ever at risk of being filtered.
const CHATTER_DEBOUNCE_MS = 25

// A bounce is two reports of ONE physical contact, so it is close together
// in both senses: the digitiser stamps the two a few ms apart, AND they
// arrive in our handler a few ms apart. Requiring both is what separates a
// bounce from the thing that used to be mistaken for one.
//
// On iOS, touch events are sometimes delivered in a batch after a stall,
// and the batched events can carry the SAME timeStamp — observed on
// device as a pair of taps 0ms apart whose event ages were 85ms and
// 118ms, i.e. two genuinely separate taps that the OS handed over
// together with collapsed timestamps. A timestamp-only filter reads that
// 0ms gap as a bounce and deletes one of the two, which in a rhythm
// trainer is a tap the player made being scored as a Miss they didn't
// earn. Arrival time tells those apart: a real bounce arrives twice in a
// few ms, a collapsed batch arrives tens of ms apart.
export function createChatterFilter() {
  const last = Object.create(null) // key -> { eventMs, arrivalMs }

  return function accept(key, eventMs) {
    const arrivalMs = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const prev = last[key]
    if (prev) {
      const eventGap = eventMs - prev.eventMs
      const arrivalGap = arrivalMs - prev.arrivalMs
      if (eventGap < CHATTER_DEBOUNCE_MS && arrivalGap < CHATTER_DEBOUNCE_MS) {
        rejects.push({ key, eventGap: Math.round(eventGap), arrivalGap: Math.round(arrivalGap) })
        if (rejects.length > 12) rejects.shift()
        rejectedCount++
        return false
      }
    }
    last[key] = { eventMs, arrivalMs }
    return true
  }
}

// Module-level so the ?debugTap=1 overlay can report what got filtered
// without every input path having to thread a counter back up to it. A
// rising reject count next to a flat judged count is what "my taps aren't
// registering" looks like from the inside.
let rejectedCount = 0
let rejects = []

export function chatterStats() {
  return { rejectedCount, recent: rejects.slice() }
}
