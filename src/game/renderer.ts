import { GAME_CONFIG } from './config';
import type { Enemy, GameConfig, GameState, PowerUp, PowerUpKind } from './types';

const COLORS = {
  background: '#020608',
  grid: 'rgba(126, 221, 208, 0.11)',
  gridAlt: 'rgba(182, 241, 200, 0.08)',
  brandGreen: '#25413c',
  cream: '#f7f1dc',
  green: '#b6f1c8',
  cyan: '#7eddd0',
  amber: '#f4d482',
  red: '#ff5161',
  magenta: '#f875ff',
  text: '#edf9ef',
  muted: '#9eb9af',
};

const POWER_UP_COLORS: Record<PowerUpKind, string> = {
  'Autonomous Coding': COLORS.green,
  'Revenue Discovery': COLORS.amber,
  'Payer Compliance': COLORS.cyan,
  'Quality Scan': COLORS.magenta,
};

export function renderGame(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  timestamp = 0,
  brandBackground?: CanvasImageSource | null,
  brandLogo?: HTMLImageElement | null,
  config: GameConfig = GAME_CONFIG,
) {
  ctx.save();
  ctx.clearRect(0, 0, config.width, config.height);
  drawBackground(ctx, timestamp, config, brandBackground);
  drawBillingLine(ctx, config);
  drawEnemies(ctx, state.enemies, timestamp);
  drawShots(ctx, state);
  drawPowerUps(ctx, state.powerUps, timestamp);
  drawPlayer(ctx, state, timestamp, brandLogo);
  drawWaveLabel(ctx, state, config);
  ctx.restore();
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  timestamp: number,
  config: GameConfig,
  brandBackground?: CanvasImageSource | null,
) {
  const pulse = 0.5 + Math.sin(timestamp / 900) * 0.18;
  if (brandBackground) {
    ctx.drawImage(brandBackground, 0, 0, config.width, config.height);
    ctx.fillStyle = 'rgba(2, 6, 8, 0.18)';
    ctx.fillRect(0, 0, config.width, config.height);
  } else {
    const gradient = ctx.createLinearGradient(0, 0, 0, config.height);
    gradient.addColorStop(0, '#031215');
    gradient.addColorStop(0.55, COLORS.background);
    gradient.addColorStop(1, '#03080a');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, config.width, config.height);
  }

  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 0; x <= config.width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, config.height);
    ctx.stroke();
  }

  ctx.strokeStyle = COLORS.gridAlt;
  for (let y = 0; y <= config.height; y += 36) {
    ctx.beginPath();
    ctx.moveTo(0, y + (timestamp / 80) % 36);
    ctx.lineTo(config.width, y + (timestamp / 80) % 36);
    ctx.stroke();
  }

  ctx.fillStyle = `rgba(190, 245, 205, ${0.035 + pulse * 0.035})`;
  ctx.fillRect(0, 0, config.width, config.height);
}

function drawBillingLine(ctx: CanvasRenderingContext2D, config: GameConfig) {
  ctx.save();
  ctx.strokeStyle = COLORS.red;
  ctx.fillStyle = COLORS.red;
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(24, config.billingLineY);
  ctx.lineTo(config.width - 24, config.billingLineY);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '700 14px "Courier New", monospace';
  ctx.fillText('PRE-BILLING LINE', 30, config.billingLineY - 10);
  ctx.restore();
}

function drawEnemies(ctx: CanvasRenderingContext2D, enemies: Enemy[], timestamp: number) {
  for (const enemy of enemies) {
    const flicker = 0.72 + Math.sin(timestamp / 180 + enemy.id) * 0.18;
    ctx.save();
    ctx.shadowColor = enemyColor(enemy);
    ctx.shadowBlur = 12 * flicker;
    ctx.fillStyle = 'rgba(247, 241, 220, 0.1)';
    ctx.strokeStyle = enemyColor(enemy);
    ctx.lineWidth = 2;
    roundedRect(ctx, enemy.x, enemy.y, enemy.width, enemy.height, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = enemyColor(enemy);
    ctx.fillRect(enemy.x + 8, enemy.y + 8, 9, 9);
    ctx.fillRect(enemy.x + enemy.width - 17, enemy.y + 8, 9, 9);
    ctx.fillStyle = 'rgba(247, 241, 220, 0.88)';
    ctx.fillRect(enemy.x + 23, enemy.y + 10, enemy.width - 46, 3);
    drawFittedText(ctx, enemy.kind, enemy.x + 8, enemy.y + 30, enemy.width - 16, 14, COLORS.text);
    ctx.restore();
  }
}

function drawShots(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.save();
  ctx.shadowColor = hasSpread(state) ? COLORS.amber : COLORS.green;
  ctx.shadowBlur = 12;
  for (const shot of state.shots) {
    ctx.fillStyle = hasSpread(state) ? COLORS.amber : COLORS.green;
    ctx.fillRect(shot.x, shot.y, shot.width, shot.height);
    ctx.fillStyle = 'rgba(230, 255, 248, 0.68)';
    ctx.fillRect(shot.x - 1, shot.y + 3, shot.width + 2, 4);
  }
  ctx.restore();
}

function drawPowerUps(ctx: CanvasRenderingContext2D, powerUps: PowerUp[], timestamp: number) {
  for (const powerUp of powerUps) {
    const color = POWER_UP_COLORS[powerUp.kind];
    const bob = Math.sin(timestamp / 140 + powerUp.id) * 3;
    ctx.save();
    ctx.translate(powerUp.x + powerUp.width / 2, powerUp.y + powerUp.height / 2 + bob);
    ctx.rotate(Math.PI / 4);
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = 'rgba(3, 13, 16, 0.92)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.fillRect(-powerUp.width / 2, -powerUp.height / 2, powerUp.width, powerUp.height);
    ctx.strokeRect(-powerUp.width / 2, -powerUp.height / 2, powerUp.width, powerUp.height);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = color;
    ctx.font = '700 11px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(powerUpLabel(powerUp.kind), 0, 1);
    ctx.restore();
  }
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  timestamp: number,
  brandLogo?: HTMLImageElement | null,
) {
  const { player } = state;
  const pulse = 0.7 + Math.sin(timestamp / 150) * 0.18;
  const centerX = player.x + player.width / 2;
  const centerY = player.y + player.height / 2 + 1;

  ctx.save();
  ctx.shadowColor = COLORS.green;
  ctx.shadowBlur = 22 * pulse;

  ctx.fillStyle = 'rgba(182, 241, 200, 0.16)';
  ctx.beginPath();
  ctx.moveTo(centerX, player.y + player.height + 2);
  ctx.lineTo(centerX - 34, player.y + player.height + 20);
  ctx.lineTo(centerX + 34, player.y + player.height + 20);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(126, 221, 208, 0.52)';
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(player.x + 9, player.y + 31);
  ctx.lineTo(player.x + 42, player.y + 20);
  ctx.lineTo(player.x + 50, player.y + 35);
  ctx.lineTo(player.x + 22, player.y + 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(player.x + player.width - 9, player.y + 31);
  ctx.lineTo(player.x + player.width - 42, player.y + 20);
  ctx.lineTo(player.x + player.width - 50, player.y + 35);
  ctx.lineTo(player.x + player.width - 22, player.y + 44);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(37, 65, 60, 0.94)';
  roundedRect(ctx, player.x + 7, player.y + 28, 29, 12, 6);
  ctx.fill();
  ctx.stroke();
  roundedRect(ctx, player.x + player.width - 36, player.y + 28, 29, 12, 6);
  ctx.fill();
  ctx.stroke();

  drawEngineFlame(ctx, player.x + 18, player.y + 43, timestamp);
  drawEngineFlame(ctx, player.x + player.width - 18, player.y + 43, timestamp + 180);

  ctx.fillStyle = 'rgba(247, 241, 220, 0.94)';
  ctx.strokeStyle = COLORS.green;
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.moveTo(centerX, player.y - 12);
  ctx.quadraticCurveTo(player.x + player.width - 31, player.y + 8, player.x + player.width - 32, centerY + 15);
  ctx.quadraticCurveTo(centerX, player.y + player.height + 3, player.x + 32, centerY + 15);
  ctx.quadraticCurveTo(player.x + 31, player.y + 8, centerX, player.y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.shadowBlur = 0;
  ctx.fillStyle = COLORS.brandGreen;
  ctx.beginPath();
  ctx.moveTo(centerX, player.y - 4);
  ctx.lineTo(centerX + 9, player.y + 16);
  ctx.lineTo(centerX - 9, player.y + 16);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COLORS.brandGreen;
  roundedRect(ctx, player.x + 28, player.y + 29, player.width - 56, 10, 6);
  ctx.fill();

  ctx.fillStyle = COLORS.cyan;
  ctx.fillRect(player.x + 34, player.y + 33, player.width - 68, 3);
  ctx.fillStyle = COLORS.amber;
  ctx.fillRect(player.x + 17, player.y + 33, 13, 4);
  ctx.fillRect(player.x + player.width - 30, player.y + 33, 13, 4);

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY - 2, 15, 0, Math.PI * 2);
  ctx.shadowColor = COLORS.green;
  ctx.shadowBlur = 14 + Math.sin(timestamp / 120) * 6;
  ctx.fillStyle = COLORS.cream;
  ctx.fill();
  ctx.strokeStyle = COLORS.brandGreen;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.clip();
  drawLogoAura(ctx, centerX, centerY - 2, timestamp);
  if (brandLogo?.complete && brandLogo.naturalWidth > 0) {
    const logoPulse = 1 + Math.sin(timestamp / 180) * 0.08;
    const logoSize = 24 * logoPulse;
    ctx.save();
    ctx.shadowColor = COLORS.green;
    ctx.shadowBlur = 10 + Math.sin(timestamp / 95) * 4;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(
      brandLogo,
      0,
      0,
      40,
      40,
      centerX - logoSize / 2,
      centerY - 2 - logoSize / 2,
      logoSize,
      logoSize,
    );
    ctx.restore();
  } else {
    drawChartaGlyph(ctx, centerX, centerY - 2, 3.8);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(centerX, centerY - 2);
  ctx.rotate(timestamp / 780);
  ctx.strokeStyle = `rgba(182, 241, 200, ${0.42 + Math.sin(timestamp / 160) * 0.16})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, 19, -0.4, Math.PI * 1.35);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();

  ctx.strokeStyle = 'rgba(37, 65, 60, 0.72)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(centerX - 24, player.y + 24);
  ctx.lineTo(centerX - 42, player.y + 34);
  ctx.moveTo(centerX + 24, player.y + 24);
  ctx.lineTo(centerX + 42, player.y + 34);
  ctx.stroke();
  ctx.restore();
}

function drawLogoAura(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  timestamp: number,
) {
  const sweep = ((timestamp / 900) % 1) * Math.PI * 2;
  const pulse = 0.5 + Math.sin(timestamp / 170) * 0.22;

  const glow = ctx.createRadialGradient(centerX, centerY, 2, centerX, centerY, 18);
  glow.addColorStop(0, `rgba(182, 241, 200, ${0.38 + pulse * 0.28})`);
  glow.addColorStop(0.62, 'rgba(126, 221, 208, 0.18)');
  glow.addColorStop(1, 'rgba(126, 221, 208, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(centerX - 18, centerY - 18, 36, 36);

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(sweep);
  ctx.fillStyle = 'rgba(182, 241, 200, 0.3)';
  ctx.fillRect(-1, -18, 2, 36);
  ctx.restore();
}

function drawEngineFlame(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  timestamp: number,
) {
  const flicker = 8 + Math.sin(timestamp / 70) * 3;
  ctx.save();
  ctx.shadowColor = COLORS.green;
  ctx.shadowBlur = 14;
  ctx.fillStyle = 'rgba(182, 241, 200, 0.72)';
  ctx.beginPath();
  ctx.moveTo(x - 7, y);
  ctx.lineTo(x, y + flicker);
  ctx.lineTo(x + 7, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(244, 212, 130, 0.82)';
  ctx.beginPath();
  ctx.moveTo(x - 3, y);
  ctx.lineTo(x, y + flicker * 0.62);
  ctx.lineTo(x + 3, y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawChartaGlyph(ctx: CanvasRenderingContext2D, centerX: number, centerY: number, size: number) {
  const cells = [
    [0, -2],
    [-1.75, -1],
    [1.75, -1],
    [-1.75, 1],
    [1.75, 1],
    [0, 2],
    [0, 0],
  ];

  ctx.save();
  ctx.fillStyle = COLORS.brandGreen;
  for (const [x, y] of cells) {
    drawHex(ctx, centerX + x * size, centerY + y * size, size);
    ctx.fill();
  }
  ctx.restore();
}

function drawHex(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number) {
  ctx.beginPath();
  for (let index = 0; index < 6; index += 1) {
    const angle = (Math.PI / 3) * index + Math.PI / 6;
    const pointX = x + Math.cos(angle) * radius;
    const pointY = y + Math.sin(angle) * radius;
    if (index === 0) {
      ctx.moveTo(pointX, pointY);
    } else {
      ctx.lineTo(pointX, pointY);
    }
  }
  ctx.closePath();
}

function drawWaveLabel(ctx: CanvasRenderingContext2D, state: GameState, config: GameConfig) {
  ctx.save();
  ctx.fillStyle = COLORS.muted;
  ctx.font = '700 13px "Courier New", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`WAVE ${Math.max(1, state.wave)} / ${config.maxWaves}`, config.width - 26, 28);
  ctx.textAlign = 'left';
  ctx.fillText('CHARTA SCANNER ONLINE', 26, 28);
  ctx.restore();
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  baseSize: number,
  color: string,
) {
  let size = baseSize;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  do {
    ctx.font = `700 ${size}px "Courier New", monospace`;
    if (ctx.measureText(text).width <= maxWidth || size <= 9) break;
    size -= 1;
  } while (size > 9);
  ctx.fillText(text, x, y);
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function enemyColor(enemy: Enemy) {
  if (enemy.kind === 'DENIAL RISK' || enemy.kind === 'UNSUPPORTED') return COLORS.red;
  if (enemy.kind === 'DOC GAP' || enemy.kind === 'CARE GAP') return COLORS.amber;
  if (enemy.kind === 'HCC MISS') return COLORS.magenta;
  return COLORS.cyan;
}

function powerUpLabel(kind: PowerUpKind) {
  if (kind === 'Autonomous Coding') return 'AI';
  if (kind === 'Revenue Discovery') return '$';
  if (kind === 'Payer Compliance') return 'PC';
  return 'QS';
}

function hasSpread(state: GameState) {
  return state.activePowerUps.some((powerUp) => powerUp.kind === 'Revenue Discovery');
}
