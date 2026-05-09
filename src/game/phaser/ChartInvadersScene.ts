import Phaser from 'phaser';
import { ENEMY_KINDS, GAME_CONFIG, POWER_UP_KINDS } from '../config';
import {
  applyEnemyReward,
  clamp,
  createInitialState,
  createWaveEnemies,
  finishGame,
} from '../logic';
import type {
  ActivePowerUp,
  Enemy,
  EnemyKind,
  GameOverReason,
  GameState,
  PowerUp,
  PowerUpKind,
} from '../types';

interface SceneCallbacks {
  getHighScore: () => number;
  onStateChange: (state: GameState) => void;
  onSound: (name: 'shoot' | 'hit' | 'powerUp' | 'breach' | 'gameOver' | 'start') => void;
  persistHighScore: (score: number) => void;
}

type EnemySprite = Phaser.Physics.Arcade.Image & {
  body: Phaser.Physics.Arcade.Body;
};

type ShotSprite = Phaser.GameObjects.Rectangle;

type PowerUpSprite = Phaser.Physics.Arcade.Image & {
  body: Phaser.Physics.Arcade.Body;
};

const TEXTURE = {
  background: 'charta-command-center',
  logo: 'charta-logo',
  shipLogo: 'charta-ship-logo',
  ship: 'charta-scanner-ship',
  shot: 'shot',
};

const COLORS = {
  brandGreen: 0x25413c,
  cream: 0xf7f1dc,
  green: 0xb6f1c8,
  cyan: 0x7eddd0,
  amber: 0xf4d482,
  red: 0xff5161,
  magenta: 0xf875ff,
  text: '#edf9ef',
  muted: '#9eb9af',
};

const ENEMY_COLORS: Record<EnemyKind, number> = {
  UNDERCODED: COLORS.cyan,
  'MISSING CPT': COLORS.cyan,
  'E/M MISMATCH': COLORS.cyan,
  'DOC GAP': COLORS.amber,
  'DENIAL RISK': COLORS.red,
  UNSUPPORTED: COLORS.red,
  'CARE GAP': COLORS.amber,
  'HCC MISS': COLORS.magenta,
};

const POWER_UP_LABELS: Record<PowerUpKind, string> = {
  'Autonomous Coding': 'AI',
  'Revenue Discovery': '$',
  'Payer Compliance': 'PC',
  'Quality Scan': 'QS',
};

const PROCEDURAL_TEXTURE_SCALE = 2;

export class ChartInvadersScene extends Phaser.Scene {
  private callbacks: SceneCallbacks;
  private state: GameState;
  private cursors?: Phaser.Types.Input.Keyboard.CursorKeys;
  private keys?: Record<'left' | 'right' | 'fire' | 'pause' | 'restart', Phaser.Input.Keyboard.Key>;
  private enemyGroup?: Phaser.Physics.Arcade.Group;
  private shotGroup?: Phaser.GameObjects.Group;
  private powerUpGroup?: Phaser.Physics.Arcade.Group;
  private playerHitbox?: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
  private ship?: Phaser.GameObjects.Container;
  private shipAura?: Phaser.GameObjects.Graphics;
  private shipRing?: Phaser.GameObjects.Arc;
  private shipSweep?: Phaser.GameObjects.Rectangle;
  private shipLogo?: Phaser.GameObjects.Image;
  private shipLogoBadge?: Phaser.GameObjects.Arc;
  private shipLogoBaseScaleX = 1;
  private shipLogoBaseScaleY = 1;
  private shipHull?: Phaser.GameObjects.Image;
  private leftFlame?: Phaser.GameObjects.Triangle;
  private rightFlame?: Phaser.GameObjects.Triangle;
  private lastHudEmitAt = 0;
  private lastPointerFireAt = -Number.MAX_SAFE_INTEGER;

  constructor(callbacks: SceneCallbacks) {
    super('ChartInvaders');
    this.callbacks = callbacks;
    this.state = createInitialState(callbacks.getHighScore());
  }

  preload() {
    this.load.image(TEXTURE.background, '/generated/charta-command-center.png');
    this.load.svg(TEXTURE.logo, '/brand/charta-logo-green.svg', { width: 141, height: 40 });
    this.load.svg(TEXTURE.shipLogo, '/brand/charta-logo-watermark-white.svg', { width: 48, height: 55 });
  }

  create() {
    this.physics.world.setBounds(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
    this.createTextures();
    this.createBackdrop();
    this.createGroups();
    this.createShip();
    this.configureInput();
    this.emitState(true);
  }

  update(time: number, delta: number) {
    this.animateShip(time);

    if (this.state.screen !== 'playing') return;

    const cappedDelta = Math.min(delta, 50);
    this.state.elapsedMs = Math.min(GAME_CONFIG.durationMs, this.state.elapsedMs + cappedDelta);
    this.state.remainingMs = Math.max(0, GAME_CONFIG.durationMs - this.state.elapsedMs);

    this.updatePlayer(cappedDelta);
    this.updateActivePowerUps(cappedDelta);
    this.updateEnemies(cappedDelta);
    this.updateShots(cappedDelta);
    this.updatePowerUps(cappedDelta);
    this.removeOffscreenObjects();
    this.resolveOverlaps();
    this.handleBreaches();
    this.advanceOrFinish();

    if (time - this.lastHudEmitAt > 110) {
      this.emitState();
      this.lastHudEmitAt = time;
    }
  }

  startRun() {
    this.clearRunObjects();
    this.state = {
      ...createInitialState(this.callbacks.getHighScore()),
      screen: 'playing',
      wave: 1,
      lastMessage: 'Wave 1: chart errors inbound.',
    };
    this.setShipVisible(true);
    this.spawnWave(1);
    this.emitState(true);
    this.callbacks.onSound('start');
  }

  restartRun() {
    this.startRun();
  }

  togglePause() {
    if (this.state.screen === 'playing') {
      this.state = {
        ...this.state,
        screen: 'paused',
        lastMessage: 'Review queue paused.',
      };
      this.emitState(true);
      return;
    }

    if (this.state.screen === 'paused') {
      this.state = {
        ...this.state,
        screen: 'playing',
        lastMessage: 'Review queue resumed.',
      };
      this.emitState(true);
    }
  }

  setMuted(_muted: boolean) {
    // Sound effects are generated in the React bridge so Phaser can stay focused on gameplay.
  }

  private createBackdrop() {
    this.add.image(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, TEXTURE.background)
      .setDisplaySize(GAME_CONFIG.width, GAME_CONFIG.height)
      .setAlpha(0.86);

    const overlay = this.add.graphics();
    overlay.fillStyle(0x020608, 0.22);
    overlay.fillRect(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
    overlay.lineStyle(1, COLORS.cyan, 0.14);
    for (let x = 0; x <= GAME_CONFIG.width; x += 48) {
      overlay.lineBetween(x, 0, x, GAME_CONFIG.height);
    }
    overlay.lineStyle(1, COLORS.green, 0.1);
    for (let y = 0; y <= GAME_CONFIG.height; y += 36) {
      overlay.lineBetween(0, y, GAME_CONFIG.width, y);
    }

    const billingLine = this.add.graphics();
    billingLine.lineStyle(2, COLORS.red, 1);
    for (let x = 24; x < GAME_CONFIG.width - 24; x += 24) {
      billingLine.lineBetween(x, GAME_CONFIG.billingLineY, x + 14, GAME_CONFIG.billingLineY);
    }

    this.add.text(30, GAME_CONFIG.billingLineY - 24, 'PRE-BILLING LINE', {
      color: '#ff5161',
      fontFamily: 'Courier New, monospace',
      fontSize: '14px',
      fontStyle: '700',
    });
    this.add.text(26, 24, 'CHARTA SCANNER ONLINE', {
      color: COLORS.muted,
      fontFamily: 'Courier New, monospace',
      fontSize: '13px',
      fontStyle: '700',
    });
    this.add.text(GAME_CONFIG.width - 26, 24, `WAVE 1 / ${GAME_CONFIG.maxWaves}`, {
      color: COLORS.muted,
      fontFamily: 'Courier New, monospace',
      fontSize: '13px',
      fontStyle: '700',
    }).setOrigin(1, 0).setName('wave-label');
  }

  private createGroups() {
    this.enemyGroup = this.physics.add.group({ allowGravity: false, immovable: true });
    this.shotGroup = this.add.group();
    this.powerUpGroup = this.physics.add.group({ allowGravity: false });
  }

  private configureInput() {
    this.cursors = this.input.keyboard?.createCursorKeys();
    this.keys = this.input.keyboard?.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      fire: Phaser.Input.Keyboard.KeyCodes.SPACE,
      pause: Phaser.Input.Keyboard.KeyCodes.P,
      restart: Phaser.Input.Keyboard.KeyCodes.R,
    }) as Record<'left' | 'right' | 'fire' | 'pause' | 'restart', Phaser.Input.Keyboard.Key>;

    this.input.keyboard?.on('keydown-P', () => this.togglePause());
    this.input.keyboard?.on('keydown-R', () => {
      if (this.state.screen === 'gameOver') this.restartRun();
    });
  }

  private createShip() {
    const player = this.state.player;
    const x = player.x + player.width / 2;
    const y = player.y + player.height / 2;

    this.playerHitbox = this.add.rectangle(x, y, player.width, player.height, 0xffffff, 0)
      .setVisible(false) as Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
    this.physics.add.existing(this.playerHitbox);
    this.playerHitbox.body.setAllowGravity(false);
    this.playerHitbox.body.setSize(player.width, player.height);
    this.playerHitbox.body.setCollideWorldBounds(true);

    this.ship = this.add.container(x, y);
    this.shipAura = this.add.graphics();
    this.ship.add(this.shipAura);

    this.leftFlame = this.add.triangle(-30, 36, -8, 0, 0, 18, 8, 0, COLORS.green, 0.72)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.rightFlame = this.add.triangle(30, 36, -8, 0, 0, 18, 8, 0, COLORS.green, 0.72)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shipHull = this.add.image(0, 0, TEXTURE.ship)
      .setDisplaySize(130, 84);
    this.shipLogoBadge = this.add.circle(0, -5, 19, COLORS.cream, 0.96)
      .setStrokeStyle(2, COLORS.green, 0.74);
    this.shipLogo = this.add.image(0, -5, TEXTURE.shipLogo)
      .setDisplaySize(26, 30);
    this.shipLogoBaseScaleX = this.shipLogo.scaleX;
    this.shipLogoBaseScaleY = this.shipLogo.scaleY;
    this.shipRing = this.add.circle(0, -5, 22)
      .setStrokeStyle(2, COLORS.green, 0.58);
    this.shipSweep = this.add.rectangle(0, -5, 3, 38, COLORS.green, 0.3)
      .setBlendMode(Phaser.BlendModes.ADD);

    this.ship.add([
      this.leftFlame,
      this.rightFlame,
      this.shipHull,
      this.shipLogoBadge,
      this.shipLogo,
      this.shipRing,
      this.shipSweep,
    ]);
    this.ship.setDepth(40);
  }

  private animateShip(time: number) {
    if (!this.ship || !this.shipAura || !this.shipLogo || !this.shipRing || !this.shipSweep) return;

    const pulse = 0.5 + Math.sin(time / 170) * 0.22;
    this.shipAura.clear();
    this.shipAura.fillStyle(COLORS.green, 0.16 + pulse * 0.12);
    this.shipAura.fillCircle(0, -4, 30);
    this.shipAura.fillStyle(COLORS.cyan, 0.08);
    this.shipAura.fillCircle(0, -2, 50);

    const logoScale = 1 + Math.sin(time / 180) * 0.08;
    this.shipLogo.setScale(this.shipLogoBaseScaleX * logoScale, this.shipLogoBaseScaleY * logoScale);
    this.shipLogo.setAlpha(0.9 + Math.sin(time / 95) * 0.08);
    this.shipLogoBadge?.setAlpha(0.9 + Math.sin(time / 170) * 0.06);
    this.shipHull?.setAlpha(0.94 + Math.sin(time / 240) * 0.04);
    this.shipRing.setRotation(time / 780);
    this.shipRing.setAlpha(0.46 + Math.sin(time / 160) * 0.16);
    this.shipSweep.setRotation(time / 900);

    const flameScale = 0.85 + Math.sin(time / 70) * 0.28;
    this.leftFlame?.setScale(1, flameScale).setAlpha(0.56 + flameScale * 0.22);
    this.rightFlame?.setScale(1, 1.7 - flameScale).setAlpha(0.62 + (1.3 - flameScale) * 0.18);
  }

  private updatePlayer(deltaMs: number) {
    if (!this.playerHitbox || !this.ship) return;

    const left = Boolean(this.cursors?.left.isDown || this.keys?.left.isDown);
    const right = Boolean(this.cursors?.right.isDown || this.keys?.right.isDown);
    const direction = left === right ? 0 : left ? -1 : 1;
    let centerX = this.playerHitbox.x + direction * GAME_CONFIG.playerSpeed * (deltaMs / 1000);

    const pointer = this.input.activePointer;
    if (pointer.isDown) {
      centerX = this.pointerWorldX(pointer);
    }

    centerX = clamp(
      centerX,
      GAME_CONFIG.playerWidth / 2 + 14,
      GAME_CONFIG.width - GAME_CONFIG.playerWidth / 2 - 14,
    );
    this.playerHitbox.setPosition(centerX, this.playerHitbox.y);
    this.playerHitbox.body.updateFromGameObject();
    this.ship.setPosition(centerX, this.playerHitbox.y);
    this.state.player = {
      ...this.state.player,
      x: centerX - GAME_CONFIG.playerWidth / 2,
    };

    const wantsFire = Boolean(this.cursors?.space.isDown || this.keys?.fire.isDown || pointer.isDown);
    if (wantsFire) {
      this.fireShots(this.state.elapsedMs);
      this.lastPointerFireAt = this.state.elapsedMs;
    } else if (this.state.elapsedMs - this.lastPointerFireAt > GAME_CONFIG.shotCooldownMs) {
      this.lastPointerFireAt = -Number.MAX_SAFE_INTEGER;
    }
  }

  private fireShots(nowMs: number) {
    if (!this.playerHitbox || !this.shotGroup) return;
    if (nowMs - this.state.lastFiredAtMs < GAME_CONFIG.shotCooldownMs) return;

    const spread = this.hasActivePowerUp('Revenue Discovery');
    const lanes = spread ? [-1, 0, 1] : [0];
    for (const lane of lanes) {
      const shot = this.add.rectangle(
        this.playerHitbox.x,
        this.playerHitbox.y - 50,
        GAME_CONFIG.shotWidth,
        GAME_CONFIG.shotHeight,
        spread ? COLORS.amber : COLORS.green,
        0.98,
      ) as ShotSprite;
      shot.setStrokeStyle(3, COLORS.cream, 0.82);
      shot.setBlendMode(Phaser.BlendModes.ADD);
      shot.setData({
        vx: lane * 210,
        previousX: shot.x,
        previousY: shot.y,
        hitWidth: spread ? 30 : 34,
      });
      shot.setDepth(25);
      this.shotGroup.add(shot);
    }

    this.flashMuzzle(this.playerHitbox.x, this.playerHitbox.y - 36, spread);
    this.state.lastFiredAtMs = nowMs;
    this.state.nextShotId += lanes.length;
    this.callbacks.onSound('shoot');
  }

  private pointerWorldX(pointer: Phaser.Input.Pointer) {
    const position = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    return position.x;
  }

  private updateActivePowerUps(deltaMs: number) {
    this.state.activePowerUps = this.state.activePowerUps
      .map((powerUp) => ({ ...powerUp, remainingMs: powerUp.remainingMs - deltaMs }))
      .filter((powerUp) => powerUp.remainingMs > 0);
  }

  private updateEnemies(deltaMs: number) {
    if (!this.enemyGroup) return;
    const enemies = this.enemyGroup.getChildren() as EnemySprite[];
    if (enemies.length === 0) return;

    const slowMultiplier = this.hasActivePowerUp('Quality Scan') ? 0.5 : 1;
    const enemySpeed = (GAME_CONFIG.enemyBaseSpeed + this.state.wave * 16) * slowMultiplier;
    const enemyDrift = GAME_CONFIG.enemyDriftDownPerSecond * slowMultiplier;
    const dt = deltaMs / 1000;

    for (const enemy of enemies) {
      enemy.x += this.state.direction * enemySpeed * dt;
      enemy.y += enemyDrift * dt;
      enemy.body.updateFromGameObject();
    }

    const minX = Math.min(...enemies.map((enemy) => enemy.x - enemy.displayWidth / 2));
    const maxX = Math.max(...enemies.map((enemy) => enemy.x + enemy.displayWidth / 2));
    if (minX < 16 || maxX > GAME_CONFIG.width - 16) {
      this.state.direction = this.state.direction === 1 ? -1 : 1;
      for (const enemy of enemies) {
        enemy.x = clamp(enemy.x, enemy.displayWidth / 2 + 16, GAME_CONFIG.width - enemy.displayWidth / 2 - 16);
        enemy.y += GAME_CONFIG.enemyDropOnEdge;
        enemy.body.updateFromGameObject();
      }
    }
  }

  private updateShots(deltaMs: number) {
    if (!this.shotGroup) return;
    const dt = deltaMs / 1000;
    for (const item of this.shotGroup.getChildren()) {
      const shot = item as ShotSprite;
      shot.setData('previousX', shot.x);
      shot.setData('previousY', shot.y);
      shot.x += (shot.getData('vx') as number) * dt;
      shot.y -= GAME_CONFIG.shotSpeed * dt;
    }
  }

  private updatePowerUps(deltaMs: number) {
    if (!this.powerUpGroup) return;

    const dt = deltaMs / 1000;
    const positions = new Map<number, Pick<PowerUp, 'x' | 'y'>>();

    for (const item of this.powerUpGroup.getChildren()) {
      const powerUp = item as PowerUpSprite;
      if (!powerUp.active) continue;

      powerUp.y += GAME_CONFIG.powerUpSpeed * dt;
      powerUp.rotation += 1.35 * dt;
      powerUp.body.updateFromGameObject();

      const id = powerUp.getData('id') as number;
      positions.set(id, {
        x: powerUp.x - GAME_CONFIG.powerUpSize / 2,
        y: powerUp.y - GAME_CONFIG.powerUpSize / 2,
      });
    }

    this.state.powerUps = this.state.powerUps.map((powerUp) => {
      const position = positions.get(powerUp.id);
      return position ? { ...powerUp, ...position } : powerUp;
    });
  }

  private resolveOverlaps() {
    if (!this.playerHitbox || !this.enemyGroup || !this.shotGroup || !this.powerUpGroup) return;

    const shots = this.shotGroup.getChildren() as ShotSprite[];
    const enemies = this.enemyGroup.getChildren() as EnemySprite[];
    for (const shot of shots) {
      if (!shot.active) continue;
      const hit = enemies.find((enemy) => enemy.active && shotIntersectsEnemy(shot, enemy));
      if (hit) this.handleShotEnemyOverlap(shot, hit);
    }

    this.physics.overlap(this.playerHitbox, this.powerUpGroup, (_player, powerUp) => {
      this.collectPowerUp(powerUp as PowerUpSprite);
    });
  }

  private handleShotEnemyOverlap(shot: ShotSprite, enemy: EnemySprite) {
    const id = enemy.getData('id') as number;
    if (!enemy.active || !shot.active) return;

    shot.destroy();
    const kind = enemy.getData('kind') as EnemyKind;
    const points = enemy.getData('points') as number;
    const row = enemy.getData('row') as number;
    this.state.score += points;
    this.state.metrics = applyEnemyReward(this.state.metrics, kind);
    this.state.lastMessage = `${kind} corrected before billing.`;
    this.state.enemies = this.state.enemies.filter((item) => item.id !== id);

    const shouldDropPowerUp = this.state.metrics.chartsReviewed > 0 && this.state.metrics.chartsReviewed % 5 === 0;
    if (shouldDropPowerUp) {
      const powerUpKind = POWER_UP_KINDS[(this.state.metrics.chartsReviewed / 5 - 1) % POWER_UP_KINDS.length];
      this.spawnPowerUp(enemy.x, enemy.y, powerUpKind);
    }

    enemy.destroy();
    this.flashCorrection(enemy.x, enemy.y, row);
    this.callbacks.onSound('hit');
    this.emitState(true);
  }

  private collectPowerUp(powerUp: PowerUpSprite) {
    if (!powerUp.active) return;
    const id = powerUp.getData('id') as number;
    const kind = powerUp.getData('kind') as PowerUpKind;
    powerUp.destroy();
    this.state.powerUps = this.state.powerUps.filter((item) => item.id !== id);
    this.applyPowerUp(kind);
    this.callbacks.onSound('powerUp');
    this.emitState(true);
  }

  private applyPowerUp(kind: PowerUpKind) {
    if (kind === 'Autonomous Coding') {
      this.clearNearestEnemyRow();
      return;
    }

    if (kind === 'Payer Compliance') {
      this.state.payerComplianceBlocks += 1;
      this.state.lastMessage = 'Payer Compliance loaded: next breach blocked.';
      return;
    }

    const activeKind = kind as ActivePowerUp['kind'];
    this.state.activePowerUps = [
      ...this.state.activePowerUps.filter((powerUp) => powerUp.kind !== activeKind),
      {
        kind: activeKind,
        remainingMs: GAME_CONFIG.powerUpDurationMs,
      },
    ];
    this.state.lastMessage =
      kind === 'Revenue Discovery'
        ? 'Revenue Discovery online: spread review enabled.'
        : 'Quality Scan online: queue velocity reduced.';
  }

  private clearNearestEnemyRow() {
    if (!this.enemyGroup) return;
    const enemies = this.enemyGroup.getChildren() as EnemySprite[];
    if (enemies.length === 0) {
      this.state.lastMessage = 'Autonomous Coding scanned a clear queue.';
      return;
    }

    const nearestRow = enemies.reduce((nearest, enemy) => {
      if (!nearest || enemy.y > nearest.y) return enemy;
      return nearest;
    }, undefined as EnemySprite | undefined)?.getData('row') as number;

    for (const enemy of enemies) {
      if ((enemy.getData('row') as number) !== nearestRow) continue;
      const id = enemy.getData('id') as number;
      const kind = enemy.getData('kind') as EnemyKind;
      const points = enemy.getData('points') as number;
      this.state.metrics = applyEnemyReward(this.state.metrics, kind);
      this.state.score += Math.round(points * 0.85);
      this.state.enemies = this.state.enemies.filter((item) => item.id !== id);
      enemy.destroy();
    }

    this.state.lastMessage = 'Autonomous Coding cleared the nearest row.';
  }

  private handleBreaches() {
    if (!this.enemyGroup) return;
    const enemies = this.enemyGroup.getChildren() as EnemySprite[];

    for (const enemy of enemies) {
      if (enemy.y + enemy.displayHeight / 2 < GAME_CONFIG.billingLineY) continue;

      const id = enemy.getData('id') as number;
      const kind = enemy.getData('kind') as EnemyKind;
      const breachValue = enemy.getData('breachValue') as number;
      this.state.enemies = this.state.enemies.filter((item) => item.id !== id);
      enemy.destroy();

      if (this.state.payerComplianceBlocks > 0) {
        this.state.payerComplianceBlocks -= 1;
        this.state.lastMessage = `Payer Compliance blocked ${kind}.`;
      } else {
        this.state.shields -= breachValue;
        this.state.lastMessage = `${kind} crossed the pre-billing line.`;
        this.callbacks.onSound('breach');
      }
      this.emitState(true);
    }

    if (this.state.shields <= 0 && this.state.screen === 'playing') {
      this.completeRun('integrityBreached');
    }
  }

  private advanceOrFinish() {
    if (this.state.screen !== 'playing' || !this.enemyGroup) return;

    if (this.state.remainingMs <= 0) {
      this.completeRun('timerComplete');
      return;
    }

    if (this.enemyGroup.countActive(true) > 0) return;

    if (this.state.wave >= GAME_CONFIG.maxWaves) {
      this.completeRun('allWavesCleared');
      return;
    }

    const nextWave = this.state.wave + 1;
    this.state.wave = nextWave;
    this.state.lastMessage = `Wave ${nextWave}: fresh chart queue synced.`;
    this.spawnWave(nextWave);
    this.updateWaveLabel();
    this.emitState(true);
  }

  private completeRun(reason: GameOverReason) {
    this.state = finishGame(this.state, reason);
    this.callbacks.persistHighScore(this.state.highScore);
    this.callbacks.onSound('gameOver');
    this.emitState(true);
  }

  private spawnWave(wave: number) {
    if (!this.enemyGroup) return;
    const enemies = createWaveEnemies(wave, this.state.nextEnemyId, GAME_CONFIG);
    this.state.enemies = enemies;
    this.state.nextEnemyId += enemies.length;
    this.updateWaveLabel();

    for (const enemy of enemies) {
      const sprite = this.physics.add.image(
        enemy.x + enemy.width / 2,
        enemy.y + enemy.height / 2,
        enemyTextureKey(enemy.kind),
      ) as EnemySprite;
      sprite.setDisplaySize(enemy.width, enemy.height);
      sprite.setData({
        id: enemy.id,
        kind: enemy.kind,
        row: enemy.row,
        points: enemy.points,
        breachValue: enemy.breachValue,
      });
      sprite.body.setAllowGravity(false);
      sprite.body.setImmovable(true);
      sprite.body.setSize(enemy.width, enemy.height);
      sprite.setDepth(10);
      this.enemyGroup.add(sprite);
    }
  }

  private spawnPowerUp(x: number, y: number, kind: PowerUpKind) {
    if (!this.powerUpGroup) return;

    const id = this.state.nextPowerUpId;
    const powerUp: PowerUp = {
      id,
      kind,
      x: x - GAME_CONFIG.powerUpSize / 2,
      y: y - GAME_CONFIG.powerUpSize / 2,
      width: GAME_CONFIG.powerUpSize,
      height: GAME_CONFIG.powerUpSize,
      vy: GAME_CONFIG.powerUpSpeed,
    };
    this.state.powerUps = [...this.state.powerUps, powerUp];
    this.state.nextPowerUpId += 1;

    const sprite = this.physics.add.image(x, y, powerUpTextureKey(kind)) as PowerUpSprite;
    sprite.setDisplaySize(GAME_CONFIG.powerUpSize, GAME_CONFIG.powerUpSize);
    sprite.setData({ id, kind });
    sprite.body.setAllowGravity(false);
    sprite.body.setVelocity(0, 0);
    sprite.body.setSize(GAME_CONFIG.powerUpSize, GAME_CONFIG.powerUpSize);
    sprite.setDepth(20);
    this.powerUpGroup.add(sprite);
  }

  private removeOffscreenObjects() {
    this.shotGroup?.getChildren().forEach((item) => {
      const shot = item as ShotSprite;
      if (shot.y < -24 || shot.x < -24 || shot.x > GAME_CONFIG.width + 24) shot.destroy();
    });
    this.powerUpGroup?.getChildren().forEach((item) => {
      const powerUp = item as PowerUpSprite;
      if (powerUp.y <= GAME_CONFIG.height + 40) return;

      const id = powerUp.getData('id') as number;
      powerUp.destroy();
      this.state.powerUps = this.state.powerUps.filter((candidate) => candidate.id !== id);
    });
  }

  private clearRunObjects() {
    this.enemyGroup?.clear(true, true);
    this.shotGroup?.clear(true, true);
    this.powerUpGroup?.clear(true, true);
  }

  private setShipVisible(visible: boolean) {
    this.ship?.setVisible(visible);
    this.playerHitbox?.setVisible(false);
  }

  private hasActivePowerUp(kind: ActivePowerUp['kind']) {
    return this.state.activePowerUps.some((powerUp) => powerUp.kind === kind);
  }

  private emitState(force = false) {
    if (!force && this.state.screen !== 'playing') return;
    this.callbacks.onStateChange({
      ...this.state,
      player: { ...this.state.player },
      metrics: { ...this.state.metrics },
      shots: [],
      enemies: [...this.state.enemies],
      powerUps: [...this.state.powerUps],
      activePowerUps: [...this.state.activePowerUps],
    });
  }

  private updateWaveLabel() {
    const label = this.children.getByName('wave-label') as Phaser.GameObjects.Text | null;
    label?.setText(`WAVE ${Math.max(1, this.state.wave)} / ${GAME_CONFIG.maxWaves}`);
  }

  private flashCorrection(x: number, y: number, row: number) {
    const color = row % 2 === 0 ? COLORS.green : COLORS.cyan;
    const flash = this.add.circle(x, y, 9, color, 0.78).setDepth(30);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2.6,
      duration: 240,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private flashMuzzle(x: number, y: number, spread: boolean) {
    const color = spread ? COLORS.amber : COLORS.green;
    const flash = this.add.circle(x, y, 7, color, 0.72)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(36);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2,
      duration: 120,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });
  }

  private createTextures() {
    this.createShipTexture();

    if (!this.textures.exists(TEXTURE.shot)) {
      const graphics = this.add.graphics();
      graphics.fillStyle(COLORS.green, 1);
      graphics.fillRect(0, 0, GAME_CONFIG.shotWidth, GAME_CONFIG.shotHeight);
      graphics.fillStyle(COLORS.cream, 0.72);
      graphics.fillRect(0, 3, GAME_CONFIG.shotWidth, 4);
      graphics.generateTexture(TEXTURE.shot, GAME_CONFIG.shotWidth, GAME_CONFIG.shotHeight);
      graphics.destroy();
    }

    for (const kind of ENEMY_KINDS) {
      this.createEnemyTexture(kind);
    }

    for (const kind of POWER_UP_KINDS) {
      this.createPowerUpTexture(kind);
    }
  }

  private createShipTexture() {
    if (this.textures.exists(TEXTURE.ship)) return;

    const width = 156;
    const height = 104;
    const texture = this.textures.createCanvas(
      TEXTURE.ship,
      width * PROCEDURAL_TEXTURE_SCALE,
      height * PROCEDURAL_TEXTURE_SCALE,
    );
    if (!texture) return;

    const context = texture.getContext();
    const centerX = width / 2;
    const centerY = height / 2 + 4;
    const green = numberToHex(COLORS.green);
    const cyan = numberToHex(COLORS.cyan);
    const cream = numberToHex(COLORS.cream);
    const brand = numberToHex(COLORS.brandGreen);

    context.scale(PROCEDURAL_TEXTURE_SCALE, PROCEDURAL_TEXTURE_SCALE);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(centerX, centerY);

    context.shadowColor = green;
    context.shadowBlur = 14;
    drawCanvasPolygon(context, [
      [-62, 18],
      [-20, -4],
      [-10, 22],
      [-45, 38],
      [-70, 34],
    ]);
    context.fillStyle = 'rgba(104, 188, 174, 0.72)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = green;
    context.stroke();

    drawCanvasPolygon(context, [
      [62, 18],
      [20, -4],
      [10, 22],
      [45, 38],
      [70, 34],
    ]);
    context.fillStyle = 'rgba(104, 188, 174, 0.72)';
    context.fill();
    context.stroke();

    context.shadowBlur = 10;
    drawCanvasPolygon(context, [
      [0, -48],
      [26, -12],
      [22, 24],
      [10, 40],
      [0, 45],
      [-10, 40],
      [-22, 24],
      [-26, -12],
    ]);
    const bodyGradient = context.createLinearGradient(0, -48, 0, 44);
    bodyGradient.addColorStop(0, cream);
    bodyGradient.addColorStop(0.52, 'rgba(247, 241, 220, 0.96)');
    bodyGradient.addColorStop(1, 'rgba(126, 221, 208, 0.62)');
    context.fillStyle = bodyGradient;
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = green;
    context.stroke();

    context.shadowBlur = 0;
    drawCanvasPolygon(context, [
      [0, -40],
      [15, -10],
      [0, 2],
      [-15, -10],
    ]);
    context.fillStyle = brand;
    context.fill();

    context.fillStyle = brand;
    drawRoundRect(context, -31, 24, 62, 15, 5);
    context.fill();
    context.strokeStyle = green;
    context.lineWidth = 2;
    context.stroke();

    context.fillStyle = cyan;
    context.shadowColor = cyan;
    context.shadowBlur = 9;
    context.fillRect(-22, 29, 44, 4);

    context.shadowBlur = 8;
    context.fillStyle = brand;
    drawRoundRect(context, -54, 25, 24, 17, 5);
    context.fill();
    context.strokeStyle = green;
    context.stroke();
    drawRoundRect(context, 30, 25, 24, 17, 5);
    context.fill();
    context.stroke();

    context.shadowBlur = 12;
    context.fillStyle = cream;
    context.beginPath();
    context.arc(0, -5, 19, 0, Math.PI * 2);
    context.fill();
    context.lineWidth = 4;
    context.strokeStyle = brand;
    context.stroke();

    context.shadowBlur = 0;
    context.strokeStyle = 'rgba(37, 65, 60, 0.56)';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(0, -5, 12, 0.18 * Math.PI, 1.82 * Math.PI);
    context.stroke();

    context.restore();
    texture.refresh();
  }

  private createEnemyTexture(kind: EnemyKind) {
    const key = enemyTextureKey(kind);
    if (this.textures.exists(key)) return;
    const texture = this.textures.createCanvas(
      key,
      GAME_CONFIG.enemyWidth * PROCEDURAL_TEXTURE_SCALE,
      GAME_CONFIG.enemyHeight * PROCEDURAL_TEXTURE_SCALE,
    );
    if (!texture) return;
    const context = texture.getContext();
    const color = numberToHex(ENEMY_COLORS[kind]);
    context.scale(PROCEDURAL_TEXTURE_SCALE, PROCEDURAL_TEXTURE_SCALE);
    context.clearRect(0, 0, GAME_CONFIG.enemyWidth, GAME_CONFIG.enemyHeight);
    drawRoundRect(context, 2, 2, GAME_CONFIG.enemyWidth - 4, GAME_CONFIG.enemyHeight - 4, 6);
    context.fillStyle = 'rgba(247, 241, 220, 0.12)';
    context.fill();
    context.lineWidth = 3;
    context.strokeStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 10;
    context.stroke();
    context.shadowBlur = 0;
    context.fillStyle = color;
    context.fillRect(10, 10, 9, 9);
    context.fillRect(GAME_CONFIG.enemyWidth - 19, 10, 9, 9);
    context.fillStyle = 'rgba(247, 241, 220, 0.86)';
    context.fillRect(25, 12, GAME_CONFIG.enemyWidth - 50, 3);
    context.fillStyle = COLORS.text;
    context.font = '700 14px "Courier New", monospace';
    context.textBaseline = 'alphabetic';
    fitCanvasText(context, kind, 9, 31, GAME_CONFIG.enemyWidth - 18, 14);
    texture.refresh();
  }

  private createPowerUpTexture(kind: PowerUpKind) {
    const key = powerUpTextureKey(kind);
    if (this.textures.exists(key)) return;
    const size = GAME_CONFIG.powerUpSize;
    const texture = this.textures.createCanvas(
      key,
      size * PROCEDURAL_TEXTURE_SCALE,
      size * PROCEDURAL_TEXTURE_SCALE,
    );
    if (!texture) return;
    const context = texture.getContext();
    const color = numberToHex(powerUpColor(kind));
    context.scale(PROCEDURAL_TEXTURE_SCALE, PROCEDURAL_TEXTURE_SCALE);
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(size / 2, size / 2);
    context.rotate(Math.PI / 4);
    context.fillStyle = 'rgba(3, 13, 16, 0.94)';
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.shadowColor = color;
    context.shadowBlur = 10;
    context.fillRect(-size / 2 + 2, -size / 2 + 2, size - 4, size - 4);
    context.strokeRect(-size / 2 + 2, -size / 2 + 2, size - 4, size - 4);
    context.restore();
    context.fillStyle = color;
    context.font = '700 11px "Courier New", monospace';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(POWER_UP_LABELS[kind], size / 2, size / 2 + 1);
    texture.refresh();
  }
}

function enemyTextureKey(kind: EnemyKind) {
  return `enemy-${kind.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
}

function powerUpTextureKey(kind: PowerUpKind) {
  return `powerup-${kind.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-')}`;
}

function powerUpColor(kind: PowerUpKind) {
  if (kind === 'Autonomous Coding') return COLORS.green;
  if (kind === 'Revenue Discovery') return COLORS.amber;
  if (kind === 'Payer Compliance') return COLORS.cyan;
  return COLORS.magenta;
}

function numberToHex(value: number) {
  return `#${value.toString(16).padStart(6, '0')}`;
}

function drawRoundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function drawCanvasPolygon(context: CanvasRenderingContext2D, points: Array<[number, number]>) {
  const first = points[0];
  if (!first) return;

  context.beginPath();
  const [firstX, firstY] = first;
  context.moveTo(firstX, firstY);
  for (const [x, y] of points.slice(1)) {
    context.lineTo(x, y);
  }
  context.closePath();
}

function fitCanvasText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
) {
  let size = baseSize;
  do {
    context.font = `700 ${size}px "Courier New", monospace`;
    if (context.measureText(text).width <= maxWidth || size <= 9) break;
    size -= 1;
  } while (size > 9);
  context.fillText(text, x, y);
}

function shotIntersectsEnemy(shot: ShotSprite, enemy: EnemySprite) {
  const previousX = (shot.getData('previousX') as number | undefined) ?? shot.x;
  const previousY = (shot.getData('previousY') as number | undefined) ?? shot.y;
  const currentBounds = shot.getBounds();
  const sweepX = Math.min(previousX, shot.x) - 10;
  const sweepY = Math.min(previousY, shot.y) - GAME_CONFIG.shotHeight / 2;
  const sweepWidth = Math.abs(shot.x - previousX) + currentBounds.width + 20;
  const sweepHeight = Math.abs(shot.y - previousY) + currentBounds.height + 8;
  const shotBounds = new Phaser.Geom.Rectangle(sweepX, sweepY, sweepWidth, sweepHeight);
  const enemyBounds = enemy.getBounds();
  enemyBounds.x -= 8;
  enemyBounds.y -= 6;
  enemyBounds.width += 16;
  enemyBounds.height += 12;
  return Phaser.Geom.Intersects.RectangleToRectangle(shotBounds, enemyBounds);
}
