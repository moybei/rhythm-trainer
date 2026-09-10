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
          const isMissed = globalIdx === state.missedIndex
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
    const targetBpmPulse = state.leadinCount % 2 === 0

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
      targetBpmPulse,
      calibrationStatusLabel,
    }
  }, [state])
}
