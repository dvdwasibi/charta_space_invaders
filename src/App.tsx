import { useMemo } from 'react';
import { CTA_URL, GAME_CONFIG, HIGH_SCORE_KEY } from './game/config';
import { usePhaserGame } from './game/usePhaserGame';
import type { ActivePowerUp } from './game/types';

function formatTime(ms: number) {
  return Math.max(0, Math.ceil(ms / 1000))
    .toString()
    .padStart(2, '0');
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(Math.round(value));
}

function formatPowerUp(activePowerUps: ActivePowerUp[], payerComplianceBlocks: number) {
  const timed = activePowerUps[0];
  if (timed) {
    return `${timed.kind} ${Math.ceil(timed.remainingMs / 1000)}s`;
  }

  if (payerComplianceBlocks > 0) {
    return `Payer Compliance x${payerComplianceBlocks}`;
  }

  return 'Ready';
}

export default function App() {
  const {
    containerRef,
    state,
    runSummary,
    muted,
    startGame,
    restartGame,
    togglePause,
    toggleMute,
  } = usePhaserGame();

  const statusText = useMemo(() => {
    if (state.screen === 'paused') return 'Review Paused';
    if (state.screen === 'gameOver') return 'Run Complete';
    if (state.screen === 'playing') return state.lastMessage;
    return 'Awaiting Chart Sync';
  }, [state.lastMessage, state.screen]);

  return (
    <main className="app-shell">
      <section className="game-frame" aria-label="Chart Invaders arcade game">
        <div className="brand-ribbon">
          <div className="brand-lockup">
            <img src="/brand/charta-logo-green.svg" alt="Charta Health" />
            <span>OPS TERMINAL</span>
          </div>
          <span>100% PRE-BILLING REVIEW SIM</span>
        </div>

        <div className="hud-grid" aria-live="polite">
          <div className="hud-tile">
            <span>Score</span>
            <strong>{formatNumber(state.score)}</strong>
          </div>
          <div className="hud-tile">
            <span>Time</span>
            <strong>{formatTime(state.remainingMs)}</strong>
          </div>
          <div className="hud-tile">
            <span>Charts</span>
            <strong>{formatNumber(state.metrics.chartsReviewed)}</strong>
          </div>
          <div className="hud-tile">
            <span>Integrity</span>
            <strong>{'█'.repeat(state.shields)}{'░'.repeat(GAME_CONFIG.initialShields - state.shields)}</strong>
          </div>
          <div className="hud-tile hud-tile-wide">
            <span>Module</span>
            <strong>{formatPowerUp(state.activePowerUps, state.payerComplianceBlocks)}</strong>
          </div>
        </div>

        <div className="screen-wrap">
          <div
            ref={containerRef}
            className="phaser-game"
            aria-label="Chart Invaders playfield"
          />

          {state.screen === 'start' && (
            <div className="screen-overlay">
              <div className="terminal-panel">
                <img className="panel-logo" src="/brand/charta-logo-green.svg" alt="Charta Health" />
                <p className="eyebrow">AI chart review arcade</p>
                <h1>Chart Invaders</h1>
                <p>
                  Clear {GAME_CONFIG.maxWaves} escalating waves of coding errors,
                  documentation gaps, and denial risks before they cross the pre-billing line.
                </p>
                <div className="control-strip" aria-label="Controls">
                  <span>Move: A/D or arrows</span>
                  <span>Fire: Space, click, or tap</span>
                  <span>Pause: P</span>
                </div>
                <button className="primary-button" type="button" onClick={startGame}>
                  Start Review
                </button>
              </div>
            </div>
          )}

          {state.screen === 'paused' && (
            <div className="screen-overlay compact">
              <div className="terminal-panel">
                <p className="eyebrow">Hold queue</p>
                <h2>Review Paused</h2>
                <button className="primary-button" type="button" onClick={togglePause}>
                  Resume Review
                </button>
              </div>
            </div>
          )}

          {state.screen === 'gameOver' && runSummary && (
            <div className="screen-overlay">
              <div className="terminal-panel summary-panel">
                <img className="panel-logo" src="/brand/charta-logo-green.svg" alt="Charta Health" />
                <p className="eyebrow">{runSummary.reasonLabel}</p>
                <h2>Run Summary</h2>
                <div className="summary-grid">
                  <span>Final score</span>
                  <strong>{formatNumber(runSummary.score)}</strong>
                  <span>High score</span>
                  <strong>{formatNumber(runSummary.highScore)}</strong>
                  <span>Charts reviewed</span>
                  <strong>{formatNumber(runSummary.metrics.chartsReviewed)}</strong>
                  <span>Revenue captured</span>
                  <strong>${formatNumber(runSummary.metrics.revenueCaptured)}</strong>
                  <span>Risk reduced</span>
                  <strong>{formatNumber(runSummary.metrics.complianceRiskReduced)}</strong>
                  <span>Quality gaps closed</span>
                  <strong>{formatNumber(runSummary.metrics.qualityGapsClosed)}</strong>
                </div>
                <p className="summary-copy">
                  You protected a handful of charts. Charta is built to review every encounter,
                  every time.
                </p>
                <div className="button-row">
                  <button className="primary-button" type="button" onClick={restartGame}>
                    Play Again
                  </button>
                  <a className="secondary-button" href={CTA_URL} target="_blank" rel="noreferrer">
                    See Charta in action
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="console-row">
          <p>{statusText}</p>
          <div className="console-actions">
            <button type="button" onClick={togglePause} disabled={state.screen === 'start' || state.screen === 'gameOver'}>
              {state.screen === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button type="button" onClick={toggleMute}>
              {muted ? 'Sound Off' : 'Sound On'}
            </button>
          </div>
        </div>

        <div className="metrics-strip">
          <span>Revenue ${formatNumber(state.metrics.revenueCaptured)}</span>
          <span>Compliance {formatNumber(state.metrics.complianceRiskReduced)}</span>
          <span>Quality {formatNumber(state.metrics.qualityGapsClosed)}</span>
          <span>Saved in {HIGH_SCORE_KEY}</span>
        </div>
      </section>
    </main>
  );
}
