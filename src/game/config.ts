import type { EnemyKind, GameConfig, PowerUpKind } from './types';

export const CTA_URL = 'https://www.chartahealth.com/demo';
export const HIGH_SCORE_KEY = 'chart-invaders-high-score-v1';

export const GAME_CONFIG: GameConfig = {
  width: 960,
  height: 540,
  durationMs: 90_000,
  maxWaves: 3,
  initialShields: 3,
  billingLineY: 438,
  playerWidth: 112,
  playerHeight: 46,
  playerY: 468,
  playerSpeed: 520,
  shotWidth: 9,
  shotHeight: 42,
  shotSpeed: 760,
  shotCooldownMs: 145,
  enemyWidth: 104,
  enemyHeight: 42,
  enemyGapX: 18,
  enemyGapY: 22,
  enemyStartX: 118,
  enemyStartY: 72,
  enemyBaseSpeed: 44,
  enemyDropOnEdge: 22,
  enemyDriftDownPerSecond: 8,
  powerUpSize: 24,
  powerUpSpeed: 130,
  powerUpDurationMs: 8_000,
};

export const ENEMY_KINDS: EnemyKind[] = [
  'UNDERCODED',
  'MISSING CPT',
  'E/M MISMATCH',
  'DOC GAP',
  'DENIAL RISK',
  'UNSUPPORTED',
  'CARE GAP',
  'HCC MISS',
];

export const POWER_UP_KINDS: PowerUpKind[] = [
  'Autonomous Coding',
  'Revenue Discovery',
  'Payer Compliance',
  'Quality Scan',
];

export const REASON_LABELS = {
  timerComplete: 'Shift complete',
  allWavesCleared: 'Pre-bill queue cleared',
  integrityBreached: 'Integrity shields depleted',
} as const;
