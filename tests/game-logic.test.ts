import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from '../src/game/config';
import {
  applyPowerUp,
  createInitialState,
  fireShots,
  rectsOverlap,
  startRun,
  stepGame,
} from '../src/game/logic';
import type { Enemy, GameState, Shot } from '../src/game/types';

function playingState(): GameState {
  return startRun(0);
}

function overlappingShot(enemy: Enemy): Shot {
  return {
    id: 999,
    x: enemy.x + enemy.width / 2,
    y: enemy.y + enemy.height / 2,
    width: GAME_CONFIG.shotWidth,
    height: GAME_CONFIG.shotHeight,
    vx: 0,
    vy: 0,
  };
}

describe('Chart Invaders game logic', () => {
  it('detects rectangle collisions', () => {
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 9, y: 9, width: 4, height: 4 })).toBe(
      true,
    );
    expect(rectsOverlap({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 11, width: 4, height: 4 })).toBe(
      false,
    );
  });

  it('fires one shot normally and three shots during Revenue Discovery', () => {
    const normal = fireShots(playingState(), 0);
    expect(normal.shots).toHaveLength(1);

    const powered = applyPowerUp(playingState(), 'Revenue Discovery');
    const fired = fireShots(powered, 0);
    expect(fired.shots).toHaveLength(3);
  });

  it('updates score and simulated metrics when a shot destroys an enemy', () => {
    const state = playingState();
    const enemy = state.enemies[0];
    const survivor = state.enemies[1];
    const next = stepGame(
      {
        ...state,
        enemies: [enemy, survivor],
        shots: [overlappingShot(enemy)],
      },
      0,
    );

    expect(next.enemies.some((item) => item.id === enemy.id)).toBe(false);
    expect(next.enemies.some((item) => item.id === survivor.id)).toBe(true);
    expect(next.score).toBeGreaterThan(0);
    expect(next.metrics.chartsReviewed).toBe(1);
  });

  it('depletes integrity shields when an enemy crosses the pre-billing line', () => {
    const state = playingState();
    const enemy = {
      ...state.enemies[0],
      y: GAME_CONFIG.billingLineY - state.enemies[0].height + 1,
    };
    const survivor = state.enemies[1];
    const next = stepGame(
      {
        ...state,
        enemies: [enemy, survivor],
      },
      0,
    );

    expect(next.shields).toBe(GAME_CONFIG.initialShields - 1);
    expect(next.enemies.some((item) => item.id === enemy.id)).toBe(false);
    expect(next.enemies.some((item) => item.id === survivor.id)).toBe(true);
  });

  it('uses Payer Compliance to block a breach before shields are damaged', () => {
    const state = applyPowerUp(playingState(), 'Payer Compliance');
    const enemy = {
      ...state.enemies[0],
      y: GAME_CONFIG.billingLineY - state.enemies[0].height + 1,
    };
    const next = stepGame(
      {
        ...state,
        enemies: [enemy],
      },
      0,
    );

    expect(next.shields).toBe(GAME_CONFIG.initialShields);
    expect(next.payerComplianceBlocks).toBe(0);
  });

  it('expires timed power-ups after their duration', () => {
    const powered = applyPowerUp(playingState(), 'Quality Scan');
    expect(powered.activePowerUps).toHaveLength(1);

    const next = stepGame(powered, GAME_CONFIG.powerUpDurationMs + 1);
    expect(next.activePowerUps).toHaveLength(0);
  });

  it('ends the run when the timer reaches zero', () => {
    const state = {
      ...playingState(),
      elapsedMs: GAME_CONFIG.durationMs - 10,
      remainingMs: 10,
    };
    const next = stepGame(state, 11);

    expect(next.screen).toBe('gameOver');
    expect(next.completedReason).toBe('timerComplete');
  });

  it('ends the run when the third wave is cleared', () => {
    const state = {
      ...playingState(),
      wave: GAME_CONFIG.maxWaves,
      enemies: [],
    };
    const next = stepGame(state, 0);

    expect(next.screen).toBe('gameOver');
    expect(next.completedReason).toBe('allWavesCleared');
  });

  it('creates a start screen state without a live queue', () => {
    const state = createInitialState(1200);

    expect(state.screen).toBe('start');
    expect(state.highScore).toBe(1200);
    expect(state.enemies).toHaveLength(0);
  });
});
