export type GameScreen = 'start' | 'playing' | 'paused' | 'gameOver';

export type EnemyKind =
  | 'UNDERCODED'
  | 'MISSING CPT'
  | 'E/M MISMATCH'
  | 'DOC GAP'
  | 'DENIAL RISK'
  | 'UNSUPPORTED'
  | 'CARE GAP'
  | 'HCC MISS';

export type PowerUpKind =
  | 'Autonomous Coding'
  | 'Revenue Discovery'
  | 'Payer Compliance'
  | 'Quality Scan';

export type GameOverReason = 'timerComplete' | 'allWavesCleared' | 'integrityBreached';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Player extends Rect {
  speed: number;
}

export interface Enemy extends Rect {
  id: number;
  kind: EnemyKind;
  row: number;
  points: number;
  breachValue: number;
}

export interface Shot extends Rect {
  id: number;
  vx: number;
  vy: number;
}

export interface PowerUp extends Rect {
  id: number;
  kind: PowerUpKind;
  vy: number;
}

export interface ActivePowerUp {
  kind: Exclude<PowerUpKind, 'Autonomous Coding' | 'Payer Compliance'>;
  remainingMs: number;
}

export interface GameMetrics {
  chartsReviewed: number;
  revenueCaptured: number;
  complianceRiskReduced: number;
  qualityGapsClosed: number;
}

export interface GameConfig {
  width: number;
  height: number;
  durationMs: number;
  maxWaves: number;
  initialShields: number;
  billingLineY: number;
  playerWidth: number;
  playerHeight: number;
  playerY: number;
  playerSpeed: number;
  shotWidth: number;
  shotHeight: number;
  shotSpeed: number;
  shotCooldownMs: number;
  enemyWidth: number;
  enemyHeight: number;
  enemyGapX: number;
  enemyGapY: number;
  enemyStartX: number;
  enemyStartY: number;
  enemyBaseSpeed: number;
  enemyDropOnEdge: number;
  enemyDriftDownPerSecond: number;
  powerUpSize: number;
  powerUpSpeed: number;
  powerUpDurationMs: number;
}

export interface GameState {
  screen: GameScreen;
  elapsedMs: number;
  remainingMs: number;
  score: number;
  highScore: number;
  player: Player;
  shots: Shot[];
  enemies: Enemy[];
  powerUps: PowerUp[];
  activePowerUps: ActivePowerUp[];
  wave: number;
  direction: 1 | -1;
  shields: number;
  payerComplianceBlocks: number;
  metrics: GameMetrics;
  lastMessage: string;
  lastFiredAtMs: number;
  nextShotId: number;
  nextEnemyId: number;
  nextPowerUpId: number;
  completedReason?: GameOverReason;
}

export interface RunSummary {
  score: number;
  highScore: number;
  metrics: GameMetrics;
  reason: GameOverReason;
  reasonLabel: string;
}
