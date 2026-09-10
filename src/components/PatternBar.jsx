import { useRef } from 'react'
import { ChevronDownIcon, SwapIcon } from './icons.jsx'
import { useFitFontSize } from '../hooks/useFitFontSize.js'

export default function PatternBar({ engine, display, isOpen, onToggleOpen, onClose }) {
  const { state } = engine
  const rowsRef = useRef(null)
  // Refit whenever the actual note layout could change shape — a different
  // pattern, or hands swapped (same beat count, but worth a re-measure for
  // safety); row highlighting/misses change far more often and don't affect
  // the row's width, so they're deliberately not in this list.
  useFitFontSize(rowsRef, [display.pattern.id, state.mirrored])

  return (
    <div className="pattern-bar" onClick={onToggleOpen}>
      <div className="pattern-bar__head">
        <span className="pattern-bar__name">{display.pattern.name}</span>
        <div className="pattern-bar__controls">
          <button
            type="button"
            className="icon-button"
            title="Swap start hand"
            onClick={(e) => {
              e.stopPropagation()
              engine.toggleMirror()
            }}
          >
            <SwapIcon active={state.mirrored} />
          </button>
          <ChevronDownIcon open={isOpen} />
        </div>
      </div>

      {isOpen ? (
        <div className="pattern-choices">
          {display.patternChoices.map((choice) => (
            <div
              key={choice.id}
              className={`pattern-choice${choice.isSelected ? ' is-selected' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                engine.selectPattern(choice.id)
                onClose()
              }}
            >
              <span className="pattern-choice__name">{choice.name}</span>
              <span className="pattern-choice__blurb">{choice.blurb}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="display-rows" ref={rowsRef}>
          {display.displayRows.map((row, rowIdx) => (
            <div className="display-row" key={rowIdx}>
              {row.beats.map((beat) => (
                <div
                  key={beat.key}
                  className={`display-beat${beat.isBarEnd ? ' display-beat--bar-end' : ''}`}
                >
                  {beat.notes.map((note) => (
                    <span
                      key={note.key}
                      className={`display-note${note.isActive ? ' is-active' : ''}`}
                      style={{
                        color: note.isMissed
                          ? 'var(--danger)'
                          : note.hand === 'L'
                            ? 'var(--l)'
                            : 'var(--r)',
                      }}
                    >
                      {note.label}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
