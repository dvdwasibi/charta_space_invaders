import Phaser from 'phaser';
import { ENEMY_KINDS, GAME_CONFIG, POWER_UP_KINDS } from '../config';
import {
  applyEnemyReward,
  clamp,
  createInitialState,
  createWaveEnemies,
  finishGame,
  getWaveAction,
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
  violet: 0xa78bfa,
  blue: 0x60a5fa,
  lime: 0xc4f76f,
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

const REFLECTION_COLORS = [
  COLORS.green,
  COLORS.cyan,
  COLORS.amber,
  COLORS.magenta,
  COLORS.violet,
  COLORS.blue,
  COLORS.lime,
];

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
  private scanSweep?: Phaser.GameObjects.Rectangle;
  private billingLineGlow?: Phaser.GameObjects.Rectangle;
  private ambientSparks: Phaser.GameObjects.Rectangle[] = [];
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
    this.createAmbientEffects();
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

  private createAmbientEffects() {
    this.scanSweep = this.add.rectangle(GAME_CONFIG.width / 2, -26, GAME_CONFIG.width, 34, COLORS.cyan, 0.07)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(2);
    this.tweens.add({
      targets: this.scanSweep,
      y: GAME_CONFIG.height + 26,
      alpha: { from: 0.03, to: 0.12 },
      duration: 3400,
      ease: 'Sine.easeInOut',
      repeat: -1,
      yoyo: false,
    });

    this.billingLineGlow = this.add.rectangle(
      GAME_CONFIG.width / 2,
      GAME_CONFIG.billingLineY,
      GAME_CONFIG.width - 52,
      7,
      COLORS.red,
      0.16,
    )
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(4);
    this.tweens.add({
      targets: this.billingLineGlow,
      alpha: { from: 0.08, to: 0.3 },
      scaleY: { from: 1, to: 2.1 },
      duration: 820,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: -1,
    });

    for (let index = 0; index < 18; index += 1) {
      const spark = this.add.rectangle(
        Phaser.Math.Between(38, GAME_CONFIG.width - 38),
        Phaser.Math.Between(42, GAME_CONFIG.billingLineY - 36),
        Phaser.Math.Between(2, 4),
        Phaser.Math.Between(10, 28),
        index % 3 === 0 ? COLORS.cyan : COLORS.green,
        Phaser.Math.FloatBetween(0.08, 0.18),
      )
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(3);
      this.ambientSparks.push(spark);
      this.tweens.add({
        targets: spark,
        y: spark.y + Phaser.Math.Between(70, 150),
        alpha: { from: spark.alpha, to: 0.02 },
        duration: Phaser.Math.Between(2200, 4200),
        delay: Phaser.Math.Between(0, 1800),
        repeat: -1,
        yoyo: true,
        ease: 'Sine.easeInOut',
      });
    }
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
    const waveAction = getWaveAction(this.state.wave, GAME_CONFIG);
    const enemySpeed = waveAction.horizontalSpeed * slowMultiplier;
    const enemyDrift = waveAction.driftSpeed * slowMultiplier;
    const dt = deltaMs / 1000;

    for (const enemy of enemies) {
      enemy.x += this.state.direction * enemySpeed * dt;
      enemy.y += enemyDrift * dt;
      enemy.body.updateFromGameObject();
      const nextReflectionAt = (enemy.getData('nextReflectionAt') as number | undefined) ?? 0;
      if (this.state.elapsedMs >= nextReflectionAt) {
        this.emitEnemyReflection(enemy, false);
        enemy.setData('nextReflectionAt', this.state.elapsedMs + Phaser.Math.Between(520, 980));
      }
    }

    const minX = Math.min(...enemies.map((enemy) => enemy.x - enemy.displayWidth / 2));
    const maxX = Math.max(...enemies.map((enemy) => enemy.x + enemy.displayWidth / 2));
    if (minX < 16 || maxX > GAME_CONFIG.width - 16) {
      this.state.direction = this.state.direction === 1 ? -1 : 1;
      for (const enemy of enemies) {
        enemy.x = clamp(enemy.x, enemy.displayWidth / 2 + 16, GAME_CONFIG.width - enemy.displayWidth / 2 - 16);
        enemy.y += waveAction.edgeDrop;
        enemy.body.updateFromGameObject();
        this.emitEnemyReflection(enemy, true);
      }
      this.flashFormationBounce(this.state.direction);
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
      const nextTrailAt = (shot.getData('nextTrailAt') as number | undefined) ?? 0;
      if (this.state.elapsedMs >= nextTrailAt) {
        this.emitShotTrail(shot.x, shot.y, shot.fillColor);
        shot.setData('nextTrailAt', this.state.elapsedMs + 60);
      }
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
      const nextTrailAt = (powerUp.getData('nextTrailAt') as number | undefined) ?? 0;
      if (this.state.elapsedMs >= nextTrailAt) {
        this.emitPowerUpTrail(powerUp.x, powerUp.y, powerUpColor(powerUp.getData('kind') as PowerUpKind));
        powerUp.setData('nextTrailAt', this.state.elapsedMs + 110);
      }

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
    const remainingHits = ((enemy.getData('hitsRemaining') as number | undefined) ?? 1) - 1;
    if (remainingHits > 0) {
      enemy.setData('hitsRemaining', remainingHits);
      enemy.setAlpha(0.76);
      this.state.lastMessage = 'HCC MISS needs one more review pass.';
      this.flashArmor(enemy.x, enemy.y);
      this.emitDataBurst(enemy.x, enemy.y, COLORS.magenta, 6);
      this.callbacks.onSound('hit');
      this.emitState(true);
      return;
    }

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
    this.emitDataBurst(enemy.x, enemy.y, ENEMY_COLORS[kind], 9);
    this.callbacks.onSound('hit');
    this.emitState(true);
  }

  private collectPowerUp(powerUp: PowerUpSprite) {
    if (!powerUp.active) return;
    const id = powerUp.getData('id') as number;
    const kind = powerUp.getData('kind') as PowerUpKind;
    powerUp.destroy();
    this.state.powerUps = this.state.powerUps.filter((item) => item.id !== id);
    this.flashPowerUpCollect(powerUp.x, powerUp.y, kind);
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
      this.flashCorrection(enemy.x, enemy.y, enemy.getData('row') as number);
      this.emitDataBurst(enemy.x, enemy.y, ENEMY_COLORS[kind], 6);
      enemy.destroy();
    }

    this.flashAutonomousSweep();
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
      const breachX = enemy.x;
      this.state.enemies = this.state.enemies.filter((item) => item.id !== id);
      enemy.destroy();

      if (this.state.payerComplianceBlocks > 0) {
        this.state.payerComplianceBlocks -= 1;
        this.state.lastMessage = `Payer Compliance blocked ${kind}.`;
        this.flashComplianceBlock(breachX);
      } else {
        this.state.shields -= breachValue;
        this.state.lastMessage = `${kind} crossed the pre-billing line.`;
        this.flashBreach(breachX);
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
    this.flashWaveIntro(wave);

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
        hitsRemaining: enemy.kind === 'HCC MISS' ? 2 : 1,
      });
      sprite.body.setAllowGravity(false);
      sprite.body.setImmovable(true);
      sprite.body.setSize(enemy.width, enemy.height);
      sprite.setDepth(10);
      this.enemyGroup.add(sprite);
      this.animateEnemySpawn(sprite, enemy);
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
    this.flashPowerUpSpawn(x, y, kind);
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
    const ring = this.add.circle(x, y, 20)
      .setStrokeStyle(2, color, 0.62)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(29);
    this.tweens.add({
      targets: ring,
      alpha: 0,
      scale: 2.2,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  private flashArmor(x: number, y: number) {
    const flash = this.add.circle(x, y, 12, COLORS.magenta, 0.66)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(31);
    this.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 2,
      duration: 220,
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
    const beam = this.add.rectangle(x, y - 28, spread ? 38 : 16, 52, color, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(34);
    this.tweens.add({
      targets: beam,
      alpha: 0,
      scaleY: 1.5,
      duration: 140,
      ease: 'Quad.easeOut',
      onComplete: () => beam.destroy(),
    });
  }

  private animateEnemySpawn(sprite: EnemySprite, enemy: Enemy) {
    const targetY = sprite.y;
    const baseScaleX = sprite.scaleX;
    const baseScaleY = sprite.scaleY;
    sprite.setY(targetY - 22);
    sprite.setAlpha(0);
    sprite.setScale(baseScaleX * 0.72, baseScaleY * 0.72);
    this.tweens.add({
      targets: sprite,
      y: targetY,
      alpha: 1,
      scaleX: baseScaleX,
      scaleY: baseScaleY,
      duration: 300,
      delay: enemy.row * 70 + (enemy.id % 6) * 24,
      ease: 'Back.easeOut',
      onUpdate: () => sprite.body?.updateFromGameObject(),
      onComplete: () => sprite.body?.updateFromGameObject(),
    });
  }

  private flashWaveIntro(wave: number) {
    const sweep = this.add.rectangle(GAME_CONFIG.width / 2, 76, GAME_CONFIG.width - 80, 4, COLORS.cyan, 0.46)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(35);
    const label = this.add.text(GAME_CONFIG.width / 2, 86, `WAVE ${wave} SYNC`, {
      color: '#b6f1c8',
      fontFamily: 'Courier New, monospace',
      fontSize: '18px',
      fontStyle: '700',
    })
      .setOrigin(0.5)
      .setAlpha(0)
      .setDepth(36);
    this.tweens.add({
      targets: sweep,
      x: GAME_CONFIG.width + 120,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => sweep.destroy(),
    });
    this.tweens.add({
      targets: label,
      alpha: { from: 0, to: 0.92 },
      y: 72,
      duration: 260,
      yoyo: true,
      hold: 260,
      ease: 'Sine.easeOut',
      onComplete: () => label.destroy(),
    });
  }

  private emitShotTrail(x: number, y: number, color: number) {
    const trail = this.add.rectangle(x, y + 18, GAME_CONFIG.shotWidth + 12, GAME_CONFIG.shotHeight * 0.75, color, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(23);
    this.tweens.add({
      targets: trail,
      alpha: 0,
      scaleX: 0.45,
      y: y + 34,
      duration: 150,
      ease: 'Quad.easeOut',
      onComplete: () => trail.destroy(),
    });
  }

  private emitPowerUpTrail(x: number, y: number, color: number) {
    const trail = this.add.circle(x, y, 10, color, 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(18);
    this.tweens.add({
      targets: trail,
      alpha: 0,
      scale: 0.2,
      y: y - 18,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => trail.destroy(),
    });
  }

  private emitDataBurst(x: number, y: number, color: number, count: number) {
    for (let index = 0; index < count; index += 1) {
      const shard = this.add.rectangle(x, y, Phaser.Math.Between(3, 7), 2, color, 0.78)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(32);
      shard.setRotation(Phaser.Math.FloatBetween(0, Math.PI));
      this.tweens.add({
        targets: shard,
        x: x + Phaser.Math.Between(-34, 34),
        y: y + Phaser.Math.Between(-26, 30),
        alpha: 0,
        rotation: shard.rotation + Phaser.Math.FloatBetween(-1.2, 1.2),
        duration: Phaser.Math.Between(220, 380),
        ease: 'Cubic.easeOut',
        onComplete: () => shard.destroy(),
      });
    }
  }

  private emitEnemyReflection(enemy: EnemySprite, strong: boolean) {
    const baseColor = ENEMY_COLORS[enemy.getData('kind') as EnemyKind] ?? COLORS.cyan;
    const color = strong
      ? REFLECTION_COLORS[(enemy.getData('id') as number) % REFLECTION_COLORS.length]
      : blendEnemyReflectionColor(baseColor, this.state.elapsedMs + (enemy.getData('id') as number) * 97);
    const direction = this.state.direction;
    const count = strong ? 5 : 2;

    for (let index = 0; index < count; index += 1) {
      const glint = this.add.rectangle(
        enemy.x + Phaser.Math.Between(-Math.round(enemy.displayWidth / 2), Math.round(enemy.displayWidth / 2)),
        enemy.y + Phaser.Math.Between(-Math.round(enemy.displayHeight / 2), Math.round(enemy.displayHeight / 2)),
        strong ? Phaser.Math.Between(10, 20) : Phaser.Math.Between(6, 12),
        strong ? 3 : 2,
        index === 0 ? baseColor : color,
        strong ? 0.82 : 0.42,
      )
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(strong ? 31 : 12);
      glint.setRotation(Phaser.Math.FloatBetween(-0.5, 0.5));
      this.tweens.add({
        targets: glint,
        x: glint.x - direction * Phaser.Math.Between(strong ? 24 : 12, strong ? 58 : 28),
        y: glint.y + Phaser.Math.Between(-18, 18),
        alpha: 0,
        scaleX: strong ? 0.25 : 0.35,
        duration: Phaser.Math.Between(strong ? 280 : 180, strong ? 460 : 320),
        ease: 'Cubic.easeOut',
        onComplete: () => glint.destroy(),
      });
    }

    if (!strong) return;

    const halo = this.add.circle(enemy.x, enemy.y, enemy.displayWidth * 0.34, color, 0.16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(11);
    this.tweens.add({
      targets: halo,
      alpha: 0,
      scaleX: 2.2,
      scaleY: 1.2,
      duration: 360,
      ease: 'Quad.easeOut',
      onComplete: () => halo.destroy(),
    });
  }

  private flashFormationBounce(direction: 1 | -1) {
    const x = direction === 1 ? 32 : GAME_CONFIG.width - 32;
    const stripe = this.add.rectangle(x, GAME_CONFIG.billingLineY / 2, 14, GAME_CONFIG.billingLineY - 42, COLORS.violet, 0.2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(9);
    const prism = this.add.rectangle(x, GAME_CONFIG.billingLineY / 2, 6, GAME_CONFIG.billingLineY - 82, COLORS.cyan, 0.36)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(10);
    this.tweens.add({
      targets: [stripe, prism],
      alpha: 0,
      scaleX: 2.8,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => {
        stripe.destroy();
        prism.destroy();
      },
    });
  }

  private flashPowerUpSpawn(x: number, y: number, kind: PowerUpKind) {
    const color = powerUpColor(kind);
    const aura = this.add.circle(x, y, 16)
      .setStrokeStyle(2, color, 0.7)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(19);
    this.tweens.add({
      targets: aura,
      alpha: 0,
      scale: 2,
      duration: 420,
      ease: 'Quad.easeOut',
      onComplete: () => aura.destroy(),
    });
  }

  private flashPowerUpCollect(x: number, y: number, kind: PowerUpKind) {
    const color = powerUpColor(kind);
    this.emitDataBurst(x, y, color, 12);
    const burst = this.add.circle(x, y, 18, color, 0.32)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(33);
    this.tweens.add({
      targets: burst,
      alpha: 0,
      scale: 2.4,
      duration: 360,
      ease: 'Quad.easeOut',
      onComplete: () => burst.destroy(),
    });
  }

  private flashAutonomousSweep() {
    const sweep = this.add.rectangle(GAME_CONFIG.width / 2, GAME_CONFIG.billingLineY - 72, GAME_CONFIG.width - 70, 34, COLORS.green, 0.18)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(33);
    this.tweens.add({
      targets: sweep,
      y: 76,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => sweep.destroy(),
    });
  }

  private flashComplianceBlock(x: number) {
    const shield = this.add.circle(x, GAME_CONFIG.billingLineY - 6, 24)
      .setStrokeStyle(3, COLORS.cyan, 0.75)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(34);
    this.tweens.add({
      targets: shield,
      alpha: 0,
      scale: 2.1,
      duration: 340,
      ease: 'Quad.easeOut',
      onComplete: () => shield.destroy(),
    });
  }

  private flashBreach(x: number) {
    this.cameras.main.flash(120, 255, 81, 97, false);
    this.cameras.main.shake(130, 0.004);
    const breach = this.add.rectangle(x, GAME_CONFIG.billingLineY, 52, 92, COLORS.red, 0.28)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(34);
    this.tweens.add({
      targets: breach,
      alpha: 0,
      scaleY: 1.5,
      duration: 260,
      ease: 'Quad.easeOut',
      onComplete: () => breach.destroy(),
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
    if (kind === 'HCC MISS') {
      drawHccArmorMarker(context);
    }
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

function blendEnemyReflectionColor(baseColor: number, seed: number) {
  const paletteIndex = Math.floor(seed / 360) % REFLECTION_COLORS.length;
  const accent = REFLECTION_COLORS[paletteIndex] ?? COLORS.cyan;
  return seed % 3 === 0 ? baseColor : accent;
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

function drawHccArmorMarker(context: CanvasRenderingContext2D) {
  context.fillStyle = 'rgba(248, 117, 255, 0.92)';
  context.fillRect(78, 29, 6, 6);
  context.fillRect(87, 29, 6, 6);
  context.strokeStyle = 'rgba(247, 241, 220, 0.76)';
  context.lineWidth = 1;
  context.strokeRect(78, 29, 6, 6);
  context.strokeRect(87, 29, 6, 6);
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
