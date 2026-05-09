import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAME_CONFIG, HIGH_SCORE_KEY } from './config';
import { GameAudio } from './audio';
import {
  buildRunSummary,
  createInitialState,
  fireShots,
  movePlayerBy,
  movePlayerToX,
  startRun,
  stepGame,
} from './logic';
import { renderGame } from './renderer';
import type { GameState } from './types';

interface InputState {
  left: boolean;
  right: boolean;
  firing: boolean;
  pointerActive: boolean;
}

function readHighScore() {
  try {
    const saved = window.localStorage.getItem(HIGH_SCORE_KEY);
    return saved ? Number.parseInt(saved, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function persistHighScore(score: number) {
  try {
    window.localStorage.setItem(HIGH_SCORE_KEY, String(score));
  } catch {
    // Local storage can be blocked in some embedded surfaces. Gameplay still works.
  }
}

export function useChartInvadersGame() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const brandBackgroundRef = useRef<HTMLImageElement | null>(null);
  const brandLogoRef = useRef<HTMLImageElement | null>(null);
  const audioRef = useRef(new GameAudio());
  const inputRef = useRef<InputState>({
    left: false,
    right: false,
    firing: false,
    pointerActive: false,
  });
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<GameState>(() => createInitialState(readHighScore()));
  const stateRef = useRef(state);

  const commitState = useCallback((next: GameState | ((current: GameState) => GameState)) => {
    setState((current) => {
      const resolved = typeof next === 'function' ? next(current) : next;
      stateRef.current = resolved;
      return resolved;
    });
  }, []);

  const renderCurrent = useCallback((timestamp = performance.now()) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const desiredWidth = Math.floor(GAME_CONFIG.width * ratio);
    const desiredHeight = Math.floor(GAME_CONFIG.height * ratio);
    if (canvas.width !== desiredWidth || canvas.height !== desiredHeight) {
      canvas.width = desiredWidth;
      canvas.height = desiredHeight;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    renderGame(ctx, stateRef.current, timestamp, brandBackgroundRef.current, brandLogoRef.current);
  }, []);

  const startGame = useCallback(() => {
    const next = startRun(readHighScore());
    stateRef.current = next;
    setState(next);
    audioRef.current.play('start');
  }, []);

  const restartGame = useCallback(() => {
    const next = startRun(readHighScore());
    stateRef.current = next;
    setState(next);
    audioRef.current.play('start');
  }, []);

  const togglePause = useCallback(() => {
    commitState((current) => {
      if (current.screen === 'playing') {
        return {
          ...current,
          screen: 'paused',
          lastMessage: 'Review queue paused.',
        };
      }

      if (current.screen === 'paused') {
        return {
          ...current,
          screen: 'playing',
          lastMessage: 'Review queue resumed.',
        };
      }

      return current;
    });
  }, [commitState]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      audioRef.current.setMuted(next);
      return next;
    });
  }, []);

  useEffect(() => {
    stateRef.current = state;
    renderCurrent();
  }, [renderCurrent, state]);

  useEffect(() => {
    audioRef.current.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.src = '/generated/charta-command-center.png';
    image.addEventListener('load', () => {
      brandBackgroundRef.current = image;
      renderCurrent();
    });
    image.addEventListener('error', () => {
      brandBackgroundRef.current = null;
    });
  }, [renderCurrent]);

  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.src = '/brand/charta-logo-green.svg';
    image.addEventListener('load', () => {
      brandLogoRef.current = image;
      renderCurrent();
    });
    image.addEventListener('error', () => {
      brandLogoRef.current = null;
    });
  }, [renderCurrent]);

  useEffect(() => {
    let animationFrame = 0;
    let lastTimestamp = performance.now();

    const tick = (timestamp: number) => {
      const deltaMs = Math.max(0, timestamp - lastTimestamp);
      lastTimestamp = timestamp;

      const current = stateRef.current;
      if (current.screen === 'playing') {
        const input = inputRef.current;
        const direction = input.left === input.right ? 0 : input.left ? -1 : 1;
        const afterMove = movePlayerBy(current, direction, deltaMs);
        const afterFire = input.firing ? fireShots(afterMove, afterMove.elapsedMs) : afterMove;

        if (afterFire.shots.length > afterMove.shots.length) {
          audioRef.current.play('shoot');
        }

        const next = stepGame(afterFire, deltaMs);

        if (next.score > current.score) {
          audioRef.current.play('hit');
        }
        if (
          next.activePowerUps.length > current.activePowerUps.length ||
          next.payerComplianceBlocks > current.payerComplianceBlocks
        ) {
          audioRef.current.play('powerUp');
        }
        if (next.shields < current.shields) {
          audioRef.current.play('breach');
        }
        if (next.screen === 'gameOver') {
          persistHighScore(next.highScore);
          audioRef.current.play('gameOver');
          inputRef.current.firing = false;
        }

        stateRef.current = next;
        setState(next);
      }

      renderCurrent(timestamp);
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [renderCurrent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        inputRef.current.left = true;
        event.preventDefault();
      }
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        inputRef.current.right = true;
        event.preventDefault();
      }
      if (event.code === 'Space') {
        inputRef.current.firing = true;
        event.preventDefault();
        if (stateRef.current.screen === 'start') startGame();
      }
      if (event.key.toLowerCase() === 'p') {
        togglePause();
      }
      if (event.key.toLowerCase() === 'r' && stateRef.current.screen === 'gameOver') {
        restartGame();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') {
        inputRef.current.left = false;
      }
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') {
        inputRef.current.right = false;
      }
      if (event.code === 'Space') {
        inputRef.current.firing = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [restartGame, startGame, togglePause]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const pointerToGameX = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return ((event.clientX - rect.left) / rect.width) * GAME_CONFIG.width;
    };

    const movePointer = (event: PointerEvent) => {
      if (stateRef.current.screen !== 'playing') return;
      const next = movePlayerToX(stateRef.current, pointerToGameX(event));
      stateRef.current = next;
      setState(next);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (stateRef.current.screen === 'start') {
        startGame();
      }
      inputRef.current.pointerActive = true;
      inputRef.current.firing = true;
      canvas.setPointerCapture(event.pointerId);
      movePointer(event);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!inputRef.current.pointerActive) return;
      movePointer(event);
    };

    const endPointer = (event: PointerEvent) => {
      inputRef.current.pointerActive = false;
      inputRef.current.firing = false;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
    };
  }, [startGame]);

  const runSummary = useMemo(() => buildRunSummary(state), [state]);

  return {
    canvasRef,
    state,
    runSummary,
    muted,
    startGame,
    restartGame,
    togglePause,
    toggleMute,
  };
}
