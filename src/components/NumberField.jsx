import { useEffect, useRef, useState } from 'react'

// A numeric text input that lets the user freely type/delete digits without
// the underlying min/max clamp firing on every keystroke — e.g. typing 150
// by clearing "120" one digit at a time used to get clamped back up to 20
// mid-edit, making it impossible to ever reach 150. The clamp (via
// `onCommit`, the engine's existing handleXInput) now only runs once the
// user is actually done editing (blur, or pressing Enter).
export default function NumberField({ className, style, value, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  const isFocusedRef = useRef(false)

  // Reflect external changes (tap tempo, a ramp, another field's side
  // effect) into the draft — but only while the user isn't actively typing
  // in this field, so it never stomps on an in-progress edit.
  useEffect(() => {
    if (!isFocusedRef.current) setDraft(String(value))
  }, [value])

  return (
    <input
      type="number"
      className={className}
      style={style}
      value={draft}
      onFocus={() => {
        isFocusedRef.current = true
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => {
        isFocusedRef.current = false
        if (Number.isNaN(parseInt(e.target.value, 10))) {
          setDraft(String(value)) // nothing valid was typed — revert, don't commit
          return
        }
        onCommit(e) // engine handler parses + clamps + patches; the effect
        // above then syncs `draft` to the (possibly clamped) result.
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          setDraft(String(value))
          e.currentTarget.blur()
        }
      }}
    />
  )
}
