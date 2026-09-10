// Sticking pattern definitions. Each pattern is a sequence of "rows" —
// a row is one subdivision phase (its own beats count + notes-per-beat
// "group") so a pattern can mix e.g. an 8th-note warm-up row with a
// 16th-note performance row, and both play at the musically correct
// relative speed.

export function tileHands(unit, total) {
  const arr = []
  for (let i = 0; i < total; i++) arr.push(unit[i % unit.length])
  return arr
}

export const PATTERNS = [
  {
    id: 'single',
    name: 'Single Stroke 1',
    blurb: '8th L, 8th R, then 16th alternating',
    rows: [
      { beats: 8, group: 2, hands: tileHands(['L'], 16) },
      { beats: 8, group: 2, hands: tileHands(['R'], 16) },
      { beats: 8, group: 4, hands: tileHands(['L', 'R'], 32) },
    ],
  },
  {
    id: 'double',
    name: 'Double Stroke 1',
    blurb: '8th alternating, then 16th LLRR',
    rows: [
      { beats: 8, group: 2, hands: tileHands(['L', 'R'], 16) },
      { beats: 8, group: 4, hands: tileHands(['L', 'L', 'R', 'R'], 32) },
    ],
  },
  {
    id: 'paradiddle',
    name: 'Single Paradiddle 1',
    blurb: '8th LLRR, then 16th paradiddle',
    rows: [
      { beats: 8, group: 2, hands: tileHands(['L', 'L', 'R', 'R'], 16) },
      { beats: 8, group: 4, hands: tileHands(['L', 'R', 'L', 'L', 'R', 'L', 'R', 'R'], 32) },
    ],
  },
]

export function currentPattern(selectedPatternId) {
  return PATTERNS.find((p) => p.id === selectedPatternId) || PATTERNS[0]
}

// Flatten a pattern's rows into one continuous hit sequence. Each hit knows
// its own subdivision (group) so mixed 8th/16th-note rows play at the
// musically correct relative speed, and isBeatStart for the metronome
// accent/bar counting, independent of how many notes are in that beat.
// `mirrored` swaps every L/R (the "swap start hand" button).
export function flattenPattern(pattern, mirrored) {
  const hits = []
  pattern.rows.forEach((row) => {
    for (let b = 0; b < row.beats; b++) {
      for (let n = 0; n < row.group; n++) {
        const rawHand = row.hands[b * row.group + n]
        const hand = mirrored ? (rawHand === 'L' ? 'R' : 'L') : rawHand
        hits.push({
          hand,
          group: row.group,
          isBeatStart: n === 0,
        })
      }
    }
  })
  return hits
}

export const ZONE_ORDER = ['L1', 'R1', 'L2', 'R2']

export const KEYBIND_META = [
  { action: 'L', label: 'Left (L)' },
  { action: 'R', label: 'Right (R)' },
  { action: 'L1', label: 'L1' },
  { action: 'R1', label: 'R1' },
  { action: 'L2', label: 'L2' },
  { action: 'R2', label: 'R2' },
]

export const DEFAULT_KEYBINDS = { L: 'D', R: 'K', L1: '5', L2: 'R', R1: '6', R2: 'Y' }
