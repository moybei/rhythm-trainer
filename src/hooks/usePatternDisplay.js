import { useMemo } from 'react'
import { currentPattern, flattenPattern, PATTERNS } from '../data/patterns.js'

// Derives everything the UI needs to render from engine state, without
// touching any scheduling internals — pure display math, recomputed each
// render (cheap: a pattern is at most a few dozen hits).
export function usePatternDisplay(state) {
  return useMemo(() => {
    const pattern = currentPattern(state.selectedPatternId)
    const hits = flattenPattern(pattern, state.mirrored)

    const displayRows = []
    let cursor = 0
    pattern.rows.forEach((row) => {
      const beats = []
      for (let b = 0; b < row.beats; b++) {
        const notes = []
        for (let n = 0; n < row.group; n++) {
          const globalIdx = cursor + b * row.group + n
          const hand = hits[globalIdx].hand
          const isMissed = state.missedIndices.includes(globalIdx)
          notes.push({
            key: globalIdx,
            label: hand,
            hand,
            isMissed,
            isActive: globalIdx === state.activeIndex,
          })
        }
        beats.push({ key: b, notes, isBarEnd: b % 4 === 3 })
      }
      displayRows.push({ beats })
      cursor += row.beats * row.group
    })

    const patternChoices = PATTERNS.map((p) => ({
      id: p.id,
      name: p.name,
      blurb: p.blurb,
      isSelected: p.id === state.selectedPatternId,
    }))

    const activeHit = state.activeIndex >= 0 ? hits[state.activeIndex] : null
    const activeHand = activeHit ? activeHit.hand : null
    const showPad = state.showTargetPad

    const filledCount = state.leadInTotal - state.leadinCount
    const leadinDots = []
    for (let i = 0; i < state.leadInTotal; i++) {
      leadinDots.push({ key: i, isFilled: i < filledCount })
    }

    let calibrationStatusLabel
    if (state.calibrationResultMs !== null && !state.calibrationRunning) {
      calibrationStatusLabel = `Done — offset set to ${state.calibrationResultMs} ms`
    } else if (!state.calibrationInTapPhase) {
      calibrationStatusLabel = 'Get ready — listening to the click…'
    } else {
      calibrationStatusLabel = `Tap along! ${state.calibrationTapsCollected} / 8`
    }

    return {
      pattern,
      displayRows,
      patternChoices,
      leftIsActive: showPad && activeHand === 'L',
      rightIsActive: showPad && activeHand === 'R',
      padL1Active: showPad && activeHand === 'L',
      padL2Active: showPad && activeHand === 'L',
      padR1Active: showPad && activeHand === 'R',
      padR2Active: showPad && activeHand === 'R',
      leadinDots,
      calibrationStatusLabel,
    }
    // Deliberately NOT `[state]` — that's a new object reference on every
    // patch() call, including ones this computation doesn't even use
    // (tapFeedback, judgementCounts, any volume/setting change). Since a
    // judged tap patches tapFeedback/judgementCounts on every single hit,
    // depending on the whole state object made this whole 64-note pattern
    // rebuild (and the DOM diff that follows it) re-run on every tap, not
    // just on an actual note/pattern change — exactly the kind of main-
    // thread work that piles up and starts dropping input under a fast,
    // sustained tapping burst (16th notes especially). Listing only the
    // fields this computation actually reads means tapping fast no longer
    // costs anything here at all; it only recomputes when the pattern
    // itself actually has something new to show.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.selectedPatternId,
    state.mirrored,
    state.missedIndices,
    state.activeIndex,
    state.showTargetPad,
    state.leadInTotal,
    state.leadinCount,
    state.calibrationResultMs,
    state.calibrationRunning,
    state.calibrationInTapPhase,
    state.calibrationTapsCollected,
  ])
}
