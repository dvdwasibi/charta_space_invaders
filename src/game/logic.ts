import { ENEMY_KINDS, GAME_CONFIG, POWER_UP_KINDS, REASON_LABELS } from './config';
import type {
  ActivePowerUp,
  Enemy,
  EnemyKind,
  GameConfig,
  GameMetrics,
  GameOverReason,
  GameState,
  PowerUp,
  PowerUpKind,
  Rect,
  RunSummary,
  Shot,
} from './types';

const EMPTY_METRICS: GameMetrics = {
  chartsReviewed: 0,
  revenueCaptured: 0,
  complianceRiskReduced: 0,
  qualityGapsClosed: 0,
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function rectsOverlap(a: Rect, b: Rect) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

export function hasActivePowerUp(
  state: GameState,
  kind: ActivePowerUp['kind'],
) {
  return state.activePowerUps.some((powerUp) => powerUp.kind === kind);
}

export function createInitialState(highScore = 0, config = GAME_CONFIG): GameState {
  return {
    screen: 'start',
    elapsedMs: 0,
    remainingMs: config.durationMs,
    score: 0,
    highScore,
    player: {
      x: config.width / 2 - config.playerWidth / 2,
      y: config.playerY,
      width: config.playerWidth,
      height: config.playerHeight,
      speed: config.playerSpeed,
    },
    shots: [],
    enemies: [],
    powerUps: [],
    activePowerUps: [],
    wave: 0,
    direction: 1,
    shields: config.initialShields,
    payerComplianceBlocks: 0,
    metrics: { ...EMPTY_METRICS },
    lastMessage: 'Press Start Review to sync the queue.',
    lastFiredAtMs: -Number.MAX_SAFE_INTEGER,
    nextShotId: 1,
    nextEnemyId: 1,
    nextPowerUpId: 1,
  };
}

export function startRun(highScore = 0, config = GAME_CONFIG): GameState {
  const initial = createInitialState(highScore, config);
  return spawnWave(
    {
      ...initial,
      screen: 'playing',
      wave: 1,
      lastMessage: 'Wave 1: chart errors inbound.',
    },
    1,
    config,
  );
}

export function createWaveEnemies(
  wave: number,
  startId = 1,
  config = GAME_CONFIG,
) {
  const rowsByWave = [3, 3, 4];
  const columns = 6;
  const rows = rowsByWave[wave - 1] ?? 4;
  const enemies: Enemy[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const kind = ENEMY_KINDS[(row * columns + column + wave) % ENEMY_KINDS.length];
      enemies.push({
        id: startId + enemies.length,
        kind,
        row,
        x: config.enemyStartX + column * (config.enemyWidth + config.enemyGapX),
        y: config.enemyStartY + row * (config.enemyHeight + config.enemyGapY),
        width: config.enemyWidth,
        height: config.enemyHeight,
        points: 75 + row * 20 + wave * 25,
        breachValue: 1,
      });
    }
  }

  return enemies;
}

export function spawnWave(state: GameState, wave: number, config = GAME_CONFIG): GameState {
  const enemies = createWaveEnemies(wave, state.nextEnemyId, config);

  return {
    ...state,
    wave,
    enemies,
    direction: 1,
    nextEnemyId: state.nextEnemyId + enemies.length,
  };
}

export function movePlayerBy(state: GameState, direction: -1 | 0 | 1, deltaMs: number, config = GAME_CONFIG) {
  if (direction === 0) return state;
  return movePlayerToX(
    state,
    state.player.x + state.player.width / 2 + direction * state.player.speed * (deltaMs / 1000),
    config,
  );
}

export function movePlayerToX(state: GameState, centerX: number, config = GAME_CONFIG): GameState {
  const x = clamp(centerX - state.player.width / 2, 14, config.width - state.player.width - 14);
  return {
    ...state,
    player: {
      ...state.player,
      x,
    },
  };
}

export function fireShots(state: GameState, nowMs = state.elapsedMs, config = GAME_CONFIG): GameState {
  if (state.screen !== 'playing') return state;
  if (nowMs - state.lastFiredAtMs < config.shotCooldownMs) return state;

  const spread = hasActivePowerUp(state, 'Revenue Discovery');
  const lanes = spread ? [-1, 0, 1] : [0];
  const shots: Shot[] = lanes.map((lane, index) => ({
    id: state.nextShotId + index,
    x: state.player.x + state.player.width / 2 - config.shotWidth / 2,
    y: state.player.y - config.shotHeight,
    width: config.shotWidth,
    height: config.shotHeight,
    vx: lane * 170,
    vy: -config.shotSpeed,
  }));

  return {
    ...state,
    shots: [...state.shots, ...shots],
    nextShotId: state.nextShotId + shots.length,
    lastFiredAtMs: nowMs,
  };
}

export function stepGame(state: GameState, deltaMs: number, config = GAME_CONFIG): GameState {
  if (state.screen !== 'playing') return state;

  const dt = Math.min(deltaMs, 50) / 1000;
  const nextElapsed = Math.min(config.durationMs, state.elapsedMs + deltaMs);
  const slowMultiplier = hasActivePowerUp(state, 'Quality Scan') ? 0.5 : 1;
  const enemySpeed = (config.enemyBaseSpeed + state.wave * 16) * slowMultiplier;
  const enemyDrift = config.enemyDriftDownPerSecond * slowMultiplier;

  let activePowerUps = state.activePowerUps
    .map((powerUp) => ({
      ...powerUp,
      remainingMs: powerUp.remainingMs - deltaMs,
    }))
    .filter((powerUp) => powerUp.remainingMs > 0);

  let enemies = state.enemies.map((enemy) => ({
    ...enemy,
    x: enemy.x + state.direction * enemySpeed * dt,
    y: enemy.y + enemyDrift * dt,
  }));
  let direction = state.direction;
  const minEnemyX = Math.min(...enemies.map((enemy) => enemy.x), Number.POSITIVE_INFINITY);
  const maxEnemyX = Math.max(
    ...enemies.map((enemy) => enemy.x + enemy.width),
    Number.NEGATIVE_INFINITY,
  );

  if (enemies.length > 0 && (minEnemyX < 16 || maxEnemyX > config.width - 16)) {
    direction = state.direction === 1 ? -1 : 1;
    enemies = enemies.map((enemy) => ({
      ...enemy,
      x: clamp(enemy.x, 16, config.width - enemy.width - 16),
      y: enemy.y + config.enemyDropOnEdge,
    }));
  }

  const shots = state.shots
    .map((shot) => ({
      ...shot,
      x: shot.x + shot.vx * dt,
      y: shot.y + shot.vy * dt,
    }))
    .filter((shot) => shot.y + shot.height > -20 && shot.x > -20 && shot.x < config.width + 20);

  const powerUps = state.powerUps
    .map((powerUp) => ({
      ...powerUp,
      y: powerUp.y + powerUp.vy * dt,
    }))
    .filter((powerUp) => powerUp.y < config.height + 40);

  let next: GameState = {
    ...state,
    elapsedMs: nextElapsed,
    remainingMs: Math.max(0, config.durationMs - nextElapsed),
    activePowerUps,
    enemies,
    shots,
    powerUps,
    direction,
  };

  next = resolveShotEnemyCollisions(next, config);
  next = collectPowerUps(next, config);
  activePowerUps = next.activePowerUps;
  next = handleBreaches({ ...next, activePowerUps }, config);
  next = advanceOrFinish(next, config);

  return next;
}

export function applyEnemyReward(metrics: GameMetrics, kind: EnemyKind): GameMetrics {
  const next = {
    ...metrics,
    chartsReviewed: metrics.chartsReviewed + 1,
  };

  if (kind === 'UNDERCODED' || kind === 'MISSING CPT' || kind === 'E/M MISMATCH' || kind === 'HCC MISS') {
    next.revenueCaptured += kind === 'HCC MISS' ? 420 : 275;
  }

  if (kind === 'DENIAL RISK' || kind === 'UNSUPPORTED' || kind === 'DOC GAP') {
    next.complianceRiskReduced += kind === 'DENIAL RISK' ? 2 : 1;
  }

  if (kind === 'CARE GAP' || kind === 'DOC GAP' || kind === 'HCC MISS') {
    next.qualityGapsClosed += 1;
  }

  return next;
}

export function applyPowerUp(state: GameState, kind: PowerUpKind, config = GAME_CONFIG): GameState {
  if (kind === 'Autonomous Coding') {
    return clearNearestEnemyRow(state);
  }

  if (kind === 'Payer Compliance') {
    return {
      ...state,
      payerComplianceBlocks: state.payerComplianceBlocks + 1,
      lastMessage: 'Payer Compliance loaded: next breach blocked.',
    };
  }

  const activeKind = kind;
  const withoutDuplicate = state.activePowerUps.filter((powerUp) => powerUp.kind !== activeKind);

  return {
    ...state,
    activePowerUps: [
      ...withoutDuplicate,
      {
        kind: activeKind,
        remainingMs: config.powerUpDurationMs,
      },
    ],
    lastMessage:
      kind === 'Revenue Discovery'
        ? 'Revenue Discovery online: spread review enabled.'
        : 'Quality Scan online: queue velocity reduced.',
  };
}

function resolveShotEnemyCollisions(state: GameState, config: GameConfig): GameState {
  const destroyedShotIds = new Set<number>();
  const destroyedEnemyIds = new Set<number>();
  let metrics = state.metrics;
  let score = state.score;
  let powerUps = state.powerUps;
  let nextPowerUpId = state.nextPowerUpId;
  let lastMessage = state.lastMessage;

  for (const shot of state.shots) {
    if (destroyedShotIds.has(shot.id)) continue;

    const hit = state.enemies.find(
      (enemy) => !destroyedEnemyIds.has(enemy.id) && rectsOverlap(shot, enemy),
    );

    if (!hit) continue;

    destroyedShotIds.add(shot.id);
    destroyedEnemyIds.add(hit.id);
    score += hit.points;
    metrics = applyEnemyReward(metrics, hit.kind);
    lastMessage = `${hit.kind} corrected before billing.`;

    if (metrics.chartsReviewed > 0 && metrics.chartsReviewed % 5 === 0) {
      const kind = POWER_UP_KINDS[(metrics.chartsReviewed / 5 - 1) % POWER_UP_KINDS.length];
      powerUps = [
        ...powerUps,
        {
          id: nextPowerUpId,
          kind,
          x: hit.x + hit.width / 2 - config.powerUpSize / 2,
          y: hit.y + hit.height / 2 - config.powerUpSize / 2,
          width: config.powerUpSize,
          height: config.powerUpSize,
          vy: config.powerUpSpeed,
        },
      ];
      nextPowerUpId += 1;
    }
  }

  if (destroyedEnemyIds.size === 0) return state;

  return {
    ...state,
    score,
    metrics,
    powerUps,
    nextPowerUpId,
    lastMessage,
    shots: state.shots.filter((shot) => !destroyedShotIds.has(shot.id)),
    enemies: state.enemies.filter((enemy) => !destroyedEnemyIds.has(enemy.id)),
  };
}

function collectPowerUps(state: GameState, config: GameConfig): GameState {
  const collected = state.powerUps.filter((powerUp) => rectsOverlap(powerUp, state.player));
  if (collected.length === 0) return state;

  let next: GameState = {
    ...state,
    powerUps: state.powerUps.filter((powerUp) => !collected.some((item) => item.id === powerUp.id)),
  };

  for (const powerUp of collected) {
    next = applyPowerUp(next, powerUp.kind, config);
  }

  return next;
}

function handleBreaches(state: GameState, config: GameConfig): GameState {
  const breaching = state.enemies.filter((enemy) => enemy.y + enemy.height >= config.billingLineY);
  if (breaching.length === 0) return state;

  let shields = state.shields;
  let payerComplianceBlocks = state.payerComplianceBlocks;
  let lastMessage = state.lastMessage;

  for (const enemy of breaching) {
    if (payerComplianceBlocks > 0) {
      payerComplianceBlocks -= 1;
      lastMessage = `Payer Compliance blocked ${enemy.kind}.`;
    } else {
      shields -= enemy.breachValue;
      lastMessage = `${enemy.kind} crossed the pre-billing line.`;
    }
  }

  const next: GameState = {
    ...state,
    enemies: state.enemies.filter((enemy) => !breaching.some((item) => item.id === enemy.id)),
    shields,
    payerComplianceBlocks,
    lastMessage,
  };

  if (shields <= 0) {
    return finishGame(next, 'integrityBreached');
  }

  return next;
}

function clearNearestEnemyRow(state: GameState): GameState {
  if (state.enemies.length === 0) {
    return {
      ...state,
      lastMessage: 'Autonomous Coding scanned a clear queue.',
    };
  }

  const nearestRow = state.enemies.reduce((nearest, enemy) => {
    if (!nearest || enemy.y > nearest.y) return enemy;
    return nearest;
  }, undefined as Enemy | undefined)?.row;

  const cleared = state.enemies.filter((enemy) => enemy.row === nearestRow);
  let metrics = state.metrics;
  let score = state.score;

  for (const enemy of cleared) {
    metrics = applyEnemyReward(metrics, enemy.kind);
    score += Math.round(enemy.points * 0.85);
  }

  return {
    ...state,
    score,
    metrics,
    enemies: state.enemies.filter((enemy) => enemy.row !== nearestRow),
    lastMessage: 'Autonomous Coding cleared the nearest row.',
  };
}

function advanceOrFinish(state: GameState, config: GameConfig): GameState {
  if (state.screen === 'gameOver') return state;

  if (state.remainingMs <= 0) {
    return finishGame(state, 'timerComplete');
  }

  if (state.enemies.length > 0) return state;

  if (state.wave >= config.maxWaves) {
    return finishGame(state, 'allWavesCleared');
  }

  return spawnWave(
    {
      ...state,
      wave: state.wave + 1,
      lastMessage: `Wave ${state.wave + 1}: fresh chart queue synced.`,
    },
    state.wave + 1,
    config,
  );
}

export function finishGame(state: GameState, reason: GameOverReason): GameState {
  const highScore = Math.max(state.highScore, state.score);

  return {
    ...state,
    screen: 'gameOver',
    highScore,
    completedReason: reason,
    shots: [],
    powerUps: [],
    activePowerUps: [],
    lastMessage: REASON_LABELS[reason],
  };
}

export function buildRunSummary(state: GameState): RunSummary | null {
  if (state.screen !== 'gameOver' || !state.completedReason) return null;

  return {
    score: state.score,
    highScore: state.highScore,
    metrics: state.metrics,
    reason: state.completedReason,
    reasonLabel: REASON_LABELS[state.completedReason],
  };
}
