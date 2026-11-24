import type { GameEvent } from './types';

const MUTE_STORAGE_KEY = 'orbit-sling-muted-v1';
const MASTER_VOLUME = 0.72;
const NOISE_DURATION_SEC = 0.5;

/**
 * Ascending C-major pentatonic scale spanning two octaves (C5..A6).
 * Keeps high combo chains bright and musical without shrill upper frequencies.
 */
const CAPTURE_SCALE_HZ = [
  523.25, // C5
  587.33, // D5
  659.25, // E5
  783.99, // G5
  880.0, // A5
  1046.5, // C6
  1174.66, // D6
  1318.51, // E6
  1567.98, // G6
  1760.0, // A6
] as const;

type AudioContextCtor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextCtor;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readPersistedMute(): boolean {
  try {
    const stored = window.localStorage.getItem(MUTE_STORAGE_KEY);
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
}

function writePersistedMute(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Ignore storage quota or private browsing restrictions
  }
}

function getAudioContextConstructor(): AudioContextCtor | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (typeof window.AudioContext === 'function') {
    return window.AudioContext;
  }
  const webkitCtor = (window as WindowWithWebkitAudio).webkitAudioContext;
  return typeof webkitCtor === 'function' ? webkitCtor : null;
}

/**
 * Zero-asset procedural Web Audio synthesizer for Orbit Sling.
 * Lazily initializes on the first user gesture and pre-builds reusable noise buffers.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private muted: boolean;

  constructor() {
    this.muted = readPersistedMute();
  }

  public unlock(): void {
    const ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Browser may still block resume until a trusted user gesture
      });
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    writePersistedMute(muted);
    this.applyMasterGain();
  }

  public toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  public handleEvent(event: GameEvent): void {
    if (this.muted) {
      return;
    }

    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master || ctx.state === 'closed') {
      return;
    }

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {
        // Ignore resume errors outside direct user gesture
      });
    }

    switch (event.type) {
      case 'launch':
        this.playLaunch(ctx, master, event.power, Boolean(event.boosted));
        break;
      case 'capture':
        this.playCapture(ctx, master, event.combo, event.skipped, event.isNewAnchor);
        break;
      case 'deflect':
        this.playDeflect(ctx, master);
        break;
      case 'shard':
        this.playShard(ctx, master, event.combo);
        break;
      case 'decayWarning':
        this.playDecayWarning(ctx, master, event.urgency);
        break;
      case 'crash':
        this.playCrash(ctx, master);
        break;
      case 'victory':
        this.playVictory(ctx, master, event.stars);
        break;
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.ctx && this.ctx.state !== 'closed') {
      return this.ctx;
    }

    const Ctor = getAudioContextConstructor();
    if (!Ctor) {
      return null;
    }

    try {
      const ctx = new Ctor();
      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this.muted ? 0 : MASTER_VOLUME, ctx.currentTime);
      masterGain.connect(ctx.destination);

      this.ctx = ctx;
      this.masterGain = masterGain;
      this.noiseBuffer = this.createNoiseBuffer(ctx);
      return ctx;
    } catch {
      return null;
    }
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * NOISE_DURATION_SEC));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      channel[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private applyMasterGain(): void {
    if (!this.ctx || !this.masterGain || this.ctx.state === 'closed') {
      return;
    }
    const now = this.ctx.currentTime;
    const target = this.muted ? 0 : MASTER_VOLUME;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.015);
  }

  private playLaunch(
    ctx: AudioContext,
    destination: AudioNode,
    power: number,
    boosted = false
  ): void {
    const now = ctx.currentTime;
    const p = clamp(power, 0, 1);

    // 1. Soft bandpass-filtered noise whoosh sweeping upward
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(2.2, now);
      const startFreq = 320 + p * 180;
      const endFreq = 1280 + p * 920;
      filter.frequency.setValueAtTime(startFreq, now);
      filter.frequency.exponentialRampToValueAtTime(endFreq, now + 0.17);

      const whooshGain = ctx.createGain();
      const peakGain = 0.08 + p * 0.08;
      whooshGain.gain.setValueAtTime(0.0001, now);
      whooshGain.gain.linearRampToValueAtTime(peakGain, now + 0.024);
      whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

      noise.connect(filter);
      filter.connect(whooshGain);
      whooshGain.connect(destination);

      noise.start(now);
      noise.stop(now + 0.21);
    }

    // 2. Subtle soft sine sub-thump (150Hz -> 70Hz over 120ms)
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(150 + p * 22, now);
    subOsc.frequency.exponentialRampToValueAtTime(70, now + 0.12);

    const subGain = ctx.createGain();
    const subPeak = 0.15 + p * 0.06;
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(subPeak, now + 0.008);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.145);

    subOsc.connect(subGain);
    subGain.connect(destination);

    subOsc.start(now);
    subOsc.stop(now + 0.16);

    // 3. Harmonic overdrive pitch rise when launching from a Boost anchor
    if (boosted) {
      const boostOsc = ctx.createOscillator();
      boostOsc.type = 'triangle';
      boostOsc.frequency.setValueAtTime(320, now);
      boostOsc.frequency.exponentialRampToValueAtTime(640, now + 0.14);

      const boostGain = ctx.createGain();
      boostGain.gain.setValueAtTime(0.0001, now);
      boostGain.gain.linearRampToValueAtTime(0.075, now + 0.014);
      boostGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      boostOsc.connect(boostGain);
      boostGain.connect(destination);

      boostOsc.start(now);
      boostOsc.stop(now + 0.18);
    }
  }

  private playDeflect(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;

    // 1. Tactile crystalline body ping (triangle 520Hz -> 310Hz over 110ms)
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(520, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(310, now + 0.11);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(0.12, now + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.125);

    bodyOsc.connect(bodyGain);
    bodyGain.connect(destination);

    bodyOsc.start(now);
    bodyOsc.stop(now + 0.14);

    // 2. Detuned metallic overtone shimmer (sine 1180Hz -> 790Hz over 110ms)
    const pingOsc = ctx.createOscillator();
    pingOsc.type = 'sine';
    pingOsc.frequency.setValueAtTime(1180, now);
    pingOsc.frequency.exponentialRampToValueAtTime(790, now + 0.11);

    const pingGain = ctx.createGain();
    pingGain.gain.setValueAtTime(0.0001, now);
    pingGain.gain.linearRampToValueAtTime(0.075, now + 0.005);
    pingGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

    pingOsc.connect(pingGain);
    pingGain.connect(destination);

    pingOsc.start(now);
    pingOsc.stop(now + 0.135);
  }

  private playCapture(
    ctx: AudioContext,
    destination: AudioNode,
    combo: number,
    skipped: number,
    isNewAnchor: boolean
  ): void {
    const now = ctx.currentTime;

    if (!isNewAnchor) {
      // Soft muted lower confirmation tone for re-capturing an already visited anchor
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(392.0, now); // G4

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(0.085, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.19);

      osc.connect(gain);
      gain.connect(destination);

      osc.start(now);
      osc.stop(now + 0.21);
      return;
    }

    const scaleIndex = clamp(Math.floor(combo) - 1, 0, CAPTURE_SCALE_HZ.length - 1);
    const fundamental = CAPTURE_SCALE_HZ[scaleIndex];

    // Primary harmonic sine chime
    this.triggerTone(ctx, destination, {
      type: 'sine',
      freq: fundamental,
      startTime: now,
      attack: 0.009,
      duration: 0.34,
      peakGain: 0.175,
    });

    // Soft triangle overtone one octave higher
    this.triggerTone(ctx, destination, {
      type: 'triangle',
      freq: fundamental * 2,
      startTime: now,
      attack: 0.012,
      duration: 0.22,
      peakGain: 0.042,
    });

    // Sparkling fifth + octave arpeggio grace notes when skipping anchor(s)
    if (skipped > 0) {
      const fifthFreq = fundamental * 1.4983;
      const octaveFreq = fundamental * 2;

      this.triggerTone(ctx, destination, {
        type: 'sine',
        freq: fifthFreq,
        startTime: now + 0.055,
        attack: 0.007,
        duration: 0.24,
        peakGain: 0.105,
      });

      this.triggerTone(ctx, destination, {
        type: 'sine',
        freq: octaveFreq,
        startTime: now + 0.11,
        attack: 0.007,
        duration: 0.28,
        peakGain: skipped >= 2 ? 0.115 : 0.09,
      });
    }
  }

  private playShard(ctx: AudioContext, destination: AudioNode, combo: number): void {
    const now = ctx.currentTime;
    const semitoneBoost = Math.min(Math.max(combo, 0), 8) * 0.5;
    const pitchMult = Math.pow(2, semitoneBoost / 12);

    // Warm bright bell ping: two closely tuned sine harmonics around 1046Hz & 1568Hz
    this.triggerTone(ctx, destination, {
      type: 'sine',
      freq: 1046.5 * pitchMult,
      startTime: now,
      attack: 0.006,
      duration: 0.18,
      peakGain: 0.13,
    });

    this.triggerTone(ctx, destination, {
      type: 'sine',
      freq: 1567.98 * pitchMult + 1.5,
      startTime: now,
      attack: 0.007,
      duration: 0.17,
      peakGain: 0.068,
    });
  }

  private playDecayWarning(ctx: AudioContext, destination: AudioNode, urgency: number): void {
    const now = ctx.currentTime;
    const u = clamp(urgency, 0, 1);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(660, now + 0.075);

    const gain = ctx.createGain();
    const peakGain = 0.05 + u * 0.04;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peakGain, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(now);
    osc.stop(now + 0.105);
  }

  private playCrash(ctx: AudioContext, destination: AudioNode): void {
    const now = ctx.currentTime;

    // 1. Short low-passed noise burst
    if (this.noiseBuffer) {
      const noise = ctx.createBufferSource();
      noise.buffer = this.noiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.Q.setValueAtTime(1.1, now);
      filter.frequency.setValueAtTime(920, now);
      filter.frequency.exponentialRampToValueAtTime(170, now + 0.24);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.linearRampToValueAtTime(0.19, now + 0.006);
      noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(destination);

      noise.start(now);
      noise.stop(now + 0.27);
    }

    // 2. Descending filtered triangle drop (240Hz -> 55Hz over 320ms)
    const bodyOsc = ctx.createOscillator();
    bodyOsc.type = 'triangle';
    bodyOsc.frequency.setValueAtTime(240, now);
    bodyOsc.frequency.exponentialRampToValueAtTime(55, now + 0.32);

    const bodyFilter = ctx.createBiquadFilter();
    bodyFilter.type = 'lowpass';
    bodyFilter.frequency.setValueAtTime(580, now);
    bodyFilter.frequency.exponentialRampToValueAtTime(160, now + 0.32);

    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.0001, now);
    bodyGain.gain.linearRampToValueAtTime(0.16, now + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    bodyOsc.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    bodyGain.connect(destination);

    bodyOsc.start(now);
    bodyOsc.stop(now + 0.36);

    // 3. Punchy sine sub-drop for low-end weight
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(175, now);
    subOsc.frequency.exponentialRampToValueAtTime(48, now + 0.32);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.0001, now);
    subGain.gain.linearRampToValueAtTime(0.14, now + 0.01);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

    subOsc.connect(subGain);
    subGain.connect(destination);

    subOsc.start(now);
    subOsc.stop(now + 0.37);
  }

  private playVictory(ctx: AudioContext, destination: AudioNode, stars: number): void {
    const now = ctx.currentTime;
    // Ascending C-major-9th extraction arpeggio: C5 -> E5 -> G5 -> D6
    const notes = [
      { freq: 523.25, delay: 0.04, duration: 0.42, gain: 0.14, overtoneGain: 0.032 }, // C5
      { freq: 659.25, delay: 0.115, duration: 0.44, gain: 0.145, overtoneGain: 0.034 }, // E5
      { freq: 783.99, delay: 0.19, duration: 0.48, gain: 0.15, overtoneGain: 0.036 }, // G5
      { freq: 1174.66, delay: 0.265, duration: 0.62, gain: 0.165, overtoneGain: 0.038 }, // D6
    ] as const;

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const startTime = now + note.delay;

      this.triggerTone(ctx, destination, {
        type: 'sine',
        freq: note.freq,
        startTime,
        attack: 0.009,
        duration: note.duration,
        peakGain: note.gain,
      });

      this.triggerTone(ctx, destination, {
        type: 'triangle',
        freq: note.freq * 2,
        startTime,
        attack: 0.012,
        duration: note.duration * 0.58,
        peakGain: note.overtoneGain,
      });
    }

    // Extra bright C6 -> E6 shimmer for a 3-star extraction
    if (stars >= 3) {
      const shimmerNotes = [
        { freq: 1046.5, delay: 0.345, duration: 0.56, gain: 0.11, overtoneGain: 0.025 }, // C6
        { freq: 1318.51, delay: 0.41, duration: 0.68, gain: 0.12, overtoneGain: 0.028 }, // E6
      ] as const;

      for (let i = 0; i < shimmerNotes.length; i++) {
        const note = shimmerNotes[i];
        const startTime = now + note.delay;

        this.triggerTone(ctx, destination, {
          type: 'sine',
          freq: note.freq,
          startTime,
          attack: 0.008,
          duration: note.duration,
          peakGain: note.gain,
        });

        this.triggerTone(ctx, destination, {
          type: 'triangle',
          freq: note.freq * 2,
          startTime,
          attack: 0.01,
          duration: note.duration * 0.56,
          peakGain: note.overtoneGain,
        });
      }
    }
  }

  private triggerTone(
    ctx: AudioContext,
    destination: AudioNode,
    options: {
      type: OscillatorType;
      freq: number;
      startTime: number;
      attack: number;
      duration: number;
      peakGain: number;
    }
  ): void {
    const { type, freq, startTime, attack, duration, peakGain } = options;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, startTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.linearRampToValueAtTime(peakGain, startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    osc.connect(gain);
    gain.connect(destination);

    osc.start(startTime);
    osc.stop(startTime + duration + 0.02);
  }
}
