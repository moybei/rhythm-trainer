export function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="var(--bg)">
      <path d="M8 5v14l11-7z" />
    </svg>
  )
}

export function PauseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="var(--bg)">
      <rect x="6" y="5" width="4" height="14" />
      <rect x="14" y="5" width="4" height="14" />
    </svg>
  )
}

export function ChevronDownIcon({ open }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className={`metronome-bar__chevron${open ? ' is-open' : ''}`}
    >
      <path
        d="M6 9l6 6 6-6"
        stroke="var(--text-dim)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SwapIcon({ active }) {
  const color = active ? 'var(--select-ring)' : 'var(--text-dim)'
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path d="M4 8h13M17 8l-3-3M17 8l-3 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 16H7M7 16l3-3M7 16l3 3" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
