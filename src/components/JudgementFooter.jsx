export default function JudgementFooter({ engine, judgementModeOpen, onToggleJudgementMode, onOpenSettings }) {
  const { state } = engine
  const counts = state.judgementCounts

  return (
    <div className="judgement-footer">
      <div className="judgement-mode">
        <button type="button" className="judgement-mode__label" onClick={onToggleJudgementMode}>
          {state.judgementMode} ▾
        </button>
        {judgementModeOpen && (
          <div className="judgement-mode__dropdown">
            <button
              type="button"
              className="judgement-mode__item"
              onClick={() => {
                engine.setJudgementMode('maimai')
                onToggleJudgementMode()
              }}
            >
              maimai
            </button>
          </div>
        )}
      </div>
      <span className="judgement-count judgement-count--yellow">
        Critical Perfect <b>{counts.critical}</b>
      </span>
      <span className="judgement-count judgement-count--yellow">
        Perfect <b>{counts.perfect}</b>
      </span>
      <span className="judgement-count judgement-count--pink">
        Great <b>{counts.great}</b>
      </span>
      <span className="judgement-count judgement-count--green">
        Good <b>{counts.good}</b>
      </span>
      <span className="judgement-count judgement-count--miss">
        Miss <b>{counts.miss}</b>
      </span>
      <div className="judgement-footer__actions">
        <button type="button" className="reset-link" onClick={engine.resetJudgementCounts}>
          Reset
        </button>
        <button type="button" className="settings-link" onClick={onOpenSettings}>
          Settings
        </button>
      </div>
    </div>
  )
}
