export default function Header({ layoutMode, onSetLayout }) {
  return (
    <div className="header">
      <div className="header__brand">
        <div className="header__dot" />
        <span className="header__title">Rhythm Trainer</span>
      </div>
      <div className="segmented">
        <button
          type="button"
          className={`segmented__option${layoutMode === 'desktop' ? ' is-active' : ''}`}
          onClick={() => onSetLayout('desktop')}
        >
          Desktop
        </button>
        <button
          type="button"
          className={`segmented__option${layoutMode === 'tablet' ? ' is-active' : ''}`}
          onClick={() => onSetLayout('tablet')}
        >
          Tablet
        </button>
      </div>
    </div>
  )
}
