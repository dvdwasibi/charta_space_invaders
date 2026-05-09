export type ToneName = 'shoot' | 'hit' | 'powerUp' | 'breach' | 'gameOver' | 'start';

type AudioWindow = Window & {
  webkitAudioContext?: typeof AudioContext;
};

const TONES: Record<ToneName, { frequency: number; duration: number; type: OscillatorType; gain: number }> = {
  shoot: { frequency: 740, duration: 0.055, type: 'square', gain: 0.04 },
  hit: { frequency: 180, duration: 0.09, type: 'sawtooth', gain: 0.055 },
  powerUp: { frequency: 920, duration: 0.16, type: 'triangle', gain: 0.065 },
  breach: { frequency: 92, duration: 0.18, type: 'sawtooth', gain: 0.08 },
  gameOver: { frequency: 72, duration: 0.35, type: 'sawtooth', gain: 0.08 },
  start: { frequency: 420, duration: 0.16, type: 'square', gain: 0.05 },
};

export class GameAudio {
  private context: AudioContext | null = null;
  private muted = false;

  setMuted(muted: boolean) {
    this.muted = muted;
  }

  play(name: ToneName) {
    if (this.muted || typeof window === 'undefined') return;

    const tone = TONES[name];
    const context = this.getContext();
    if (!context) return;

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, context.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(20, tone.frequency * 0.5),
      context.currentTime + tone.duration,
    );
    gain.gain.setValueAtTime(tone.gain, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + tone.duration);
  }

  private getContext() {
    if (this.context) return this.context;

    const AudioContextConstructor =
      window.AudioContext ?? (window as AudioWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;

    this.context = new AudioContextConstructor();
    return this.context;
  }
}
