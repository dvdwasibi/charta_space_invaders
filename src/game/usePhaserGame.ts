import Phaser from 'phaser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GAME_CONFIG, HIGH_SCORE_KEY } from './config';
import { GameAudio } from './audio';
import { buildRunSummary, createInitialState } from './logic';
import { ChartInvadersScene } from './phaser/ChartInvadersScene';
import type { GameState } from './types';

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
    // Embedded browsers can block storage. The run still completes normally.
  }
}

export function usePhaserGame() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<ChartInvadersScene | null>(null);
  const audioRef = useRef(new GameAudio());
  const [muted, setMuted] = useState(false);
  const [state, setState] = useState<GameState>(() => createInitialState(readHighScore()));

  const receiveState = useCallback((next: GameState) => {
    setState(next);
  }, []);

  const playSound = useCallback((name: 'shoot' | 'hit' | 'powerUp' | 'breach' | 'gameOver' | 'start') => {
    audioRef.current.play(name);
  }, []);

  useEffect(() => {
    audioRef.current.setMuted(muted);
    sceneRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    if (!containerRef.current || gameRef.current) return undefined;

    const scene = new ChartInvadersScene({
      getHighScore: readHighScore,
      onStateChange: receiveState,
      onSound: playSound,
      persistHighScore,
    });
    sceneRef.current = scene;

    gameRef.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: GAME_CONFIG.width,
      height: GAME_CONFIG.height,
      backgroundColor: '#020608',
      scene,
      physics: {
        default: 'arcade',
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false,
        },
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GAME_CONFIG.width,
        height: GAME_CONFIG.height,
      },
      render: {
        antialias: true,
        pixelArt: false,
        roundPixels: false,
      },
    });

    return () => {
      gameRef.current?.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
  }, [playSound, receiveState]);

  const startGame = useCallback(() => {
    sceneRef.current?.startRun();
  }, []);

  const restartGame = useCallback(() => {
    sceneRef.current?.restartRun();
  }, []);

  const togglePause = useCallback(() => {
    sceneRef.current?.togglePause();
  }, []);

  const toggleMute = useCallback(() => {
    setMuted((current) => !current);
  }, []);

  const runSummary = useMemo(() => buildRunSummary(state), [state]);

  return {
    containerRef,
    state,
    runSummary,
    muted,
    startGame,
    restartGame,
    togglePause,
    toggleMute,
  };
}
