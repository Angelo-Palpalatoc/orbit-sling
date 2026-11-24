import './style.css';
import { AudioEngine } from './game/audio';
import { GameEngine } from './game/engine';
import { GameRenderer } from './game/renderer';
import type { GameOverReason, GameState, GameStatus } from './game/types';

const GAME_OVER_COPY: Record<GameOverReason, string> = {
  OUT_OF_SECTOR: 'DRIFTED OUT OF SECTOR',
  ORBIT_DECAYED: 'ANCHOR ORBIT DECAYED',
  DRONE_COLLISION: 'HAZARD DRONE IMPACT',
};

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required DOM element not found: #${id}`);
  }
  return el as unknown as T;
}

interface UiSnapshot {
  score: number;
  bestScore: number;
  combo: number;
  maxCombo: number;
  isNewBest: boolean;
  status: GameStatus | null;
  reason: GameOverReason | null;
  startOverlayVisible: boolean | null;
  aiming: boolean;
}

function bootstrap(): void {
  const appRoot = requireElement<HTMLElement>('app');
  const canvas = requireElement<HTMLCanvasElement>('game-canvas');
  const hudScore = requireElement<HTMLElement>('hud-score');
  const hudBest = requireElement<HTMLElement>('hud-best');
  const hudCombo = requireElement<HTMLElement>('hud-combo');
  const hudComboVal = requireElement<HTMLElement>('hud-combo-val');
  const btnRestart = requireElement<HTMLButtonElement>('btn-restart');
  const btnMute = requireElement<HTMLButtonElement>('btn-mute');
  const iconSoundOn = requireElement<Element>('icon-sound-on');
  const iconSoundOff = requireElement<Element>('icon-sound-off');
  const startOverlay = requireElement<HTMLElement>('start-overlay');
  const gameoverOverlay = requireElement<HTMLElement>('gameover-overlay');
  const gameoverReason = requireElement<HTMLElement>('gameover-reason');
  const goScore = requireElement<HTMLElement>('go-score');
  const goBest = requireElement<HTMLElement>('go-best');
  const goNewBest = requireElement<HTMLElement>('go-new-best');
  const goMaxCombo = requireElement<HTMLElement>('go-max-combo');
  const btnPlayAgain = requireElement<HTMLButtonElement>('btn-play-again');

  const audio = new AudioEngine();
  const engine = new GameEngine((event) => {
    audio.handleEvent(event);
  });
  const renderer = new GameRenderer(canvas);

  const ui: UiSnapshot = {
    score: -1,
    bestScore: -1,
    combo: -1,
    maxCombo: -1,
    isNewBest: false,
    status: null,
    reason: null,
    startOverlayVisible: null,
    aiming: false,
  };

  let activePointerId: number | null = null;
  let lastViewportWidth = 0;
  let lastViewportHeight = 0;
  let lastDpr = 0;

  function updateMuteButton(muted: boolean): void {
    btnMute.setAttribute('aria-pressed', String(muted));
    btnMute.title = muted ? 'Unmute sound (M)' : 'Mute sound (M)';
    btnMute.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    iconSoundOn.toggleAttribute('hidden', muted);
    iconSoundOff.toggleAttribute('hidden', !muted);
  }

  function handleResize(): void {
    const width = appRoot.clientWidth || window.innerWidth;
    const height = appRoot.clientHeight || window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    if (width === lastViewportWidth && height === lastViewportHeight && dpr === lastDpr) {
      return;
    }
    lastViewportWidth = width;
    lastViewportHeight = height;
    lastDpr = dpr;
    renderer.resize(width, height, dpr);
  }

  function getCanvasCoords(e: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function releaseActivePointer(pointerId?: number): void {
    if (pointerId !== undefined && canvas.hasPointerCapture(pointerId)) {
      try {
        canvas.releasePointerCapture(pointerId);
      } catch {
        // Ignore if capture was already released
      }
    }
    activePointerId = null;
    canvas.classList.remove('is-aiming');
    ui.aiming = false;
  }

  function restartGame(): void {
    releaseActivePointer(activePointerId ?? undefined);
    engine.reset();
    syncUI(engine.state);
  }

  function syncUI(state: GameState): void {
    if (state.score !== ui.score) {
      ui.score = state.score;
      hudScore.textContent = String(state.score);
    }

    if (state.bestScore !== ui.bestScore) {
      ui.bestScore = state.bestScore;
      hudBest.textContent = String(state.bestScore);
    }

    if (state.combo !== ui.combo) {
      const prevCombo = ui.combo;
      ui.combo = state.combo;

      if (state.combo >= 2) {
        hudCombo.hidden = false;
        hudComboVal.textContent = `x${state.combo}`;
        if (state.combo > prevCombo) {
          hudCombo.classList.remove('combo-pop');
          void hudCombo.offsetWidth;
          hudCombo.classList.add('combo-pop');
        }
      } else {
        hudCombo.hidden = true;
        hudCombo.classList.remove('combo-pop');
      }
    }

    const startVisible = state.status === 'ready' && !state.aim.active;
    if (startVisible !== ui.startOverlayVisible) {
      ui.startOverlayVisible = startVisible;
      startOverlay.classList.toggle('is-hidden', !startVisible);
      startOverlay.setAttribute('aria-hidden', String(!startVisible));
    }

    if (state.aim.active !== ui.aiming) {
      ui.aiming = state.aim.active;
      canvas.classList.toggle('is-aiming', state.aim.active);
    }

    const statusChanged = state.status !== ui.status;
    if (statusChanged) {
      ui.status = state.status;
      gameoverOverlay.hidden = state.status !== 'gameover';
    }

    if (state.status === 'gameover') {
      if (statusChanged || state.gameOverReason !== ui.reason) {
        ui.reason = state.gameOverReason;
        gameoverReason.textContent = state.gameOverReason
          ? GAME_OVER_COPY[state.gameOverReason]
          : 'SIGNAL LOST';
      }

      if (statusChanged) {
        goScore.textContent = String(state.score);
        goBest.textContent = String(state.bestScore);
      }

      if (statusChanged || state.maxCombo !== ui.maxCombo) {
        ui.maxCombo = state.maxCombo;
        goMaxCombo.textContent = `x${Math.max(1, state.maxCombo)}`;
      }

      if (statusChanged || state.isNewBest !== ui.isNewBest) {
        ui.isNewBest = state.isNewBest;
        goNewBest.hidden = !state.isNewBest;
      }
    } else if (statusChanged) {
      ui.reason = null;
      ui.isNewBest = false;
      ui.maxCombo = state.maxCombo;
    }
  }

  let bufferedStartPos: { x: number; y: number } | null = null;

  // Unified Pointer Events on canvas
  canvas.addEventListener('pointerdown', (e: PointerEvent) => {
    audio.unlock();

    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }

    if (engine.state.status === 'gameover') {
      if (engine.canQuickRestart()) {
        restartGame();
      }
      return;
    }

    if (activePointerId !== null) {
      return;
    }

    activePointerId = e.pointerId;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Fallback safely if pointer capture is unsupported
    }

    const pos = getCanvasCoords(e);
    bufferedStartPos = pos;
    engine.beginAim(pos.x, pos.y, renderer.getViewport());
    canvas.classList.toggle('is-aiming', engine.state.aim.active);
    ui.aiming = engine.state.aim.active;
  });

  canvas.addEventListener('pointermove', (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) {
      return;
    }

    const pos = getCanvasCoords(e);
    const viewport = renderer.getViewport();
    if (!engine.state.aim.active && engine.state.probe.mode === 'orbiting' && bufferedStartPos) {
      engine.beginAim(bufferedStartPos.x, bufferedStartPos.y, viewport);
    }
    engine.updateAim(pos.x, pos.y, viewport);
    canvas.classList.toggle('is-aiming', engine.state.aim.active);
    ui.aiming = engine.state.aim.active;
  });

  canvas.addEventListener('pointerup', (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) {
      return;
    }

    if (engine.state.aim.active) {
      const pos = getCanvasCoords(e);
      engine.updateAim(pos.x, pos.y, renderer.getViewport());
      engine.releaseAim();
    }

    bufferedStartPos = null;
    releaseActivePointer(e.pointerId);
  });

  canvas.addEventListener('pointercancel', (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) {
      return;
    }

    bufferedStartPos = null;
    engine.cancelAim();
    releaseActivePointer(e.pointerId);
  });

  canvas.addEventListener('lostpointercapture', (e: PointerEvent) => {
    if (activePointerId === null || e.pointerId !== activePointerId) {
      return;
    }

    bufferedStartPos = null;
    engine.cancelAim();
    releaseActivePointer();
  });

  canvas.addEventListener('contextmenu', (e: MouseEvent) => {
    e.preventDefault();
  });

  // Tap/click outside the Game Over card for quick mobile restart
  gameoverOverlay.addEventListener('pointerdown', (e: PointerEvent) => {
    audio.unlock();
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    const target = e.target as Element | null;
    if (target?.closest('.gameover-card')) {
      return;
    }
    if (engine.state.status === 'gameover' && engine.canQuickRestart()) {
      restartGame();
    }
  });

  // HUD & Game Over buttons
  btnPlayAgain.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });

  btnPlayAgain.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    restartGame();
    btnPlayAgain.blur();
  });

  btnRestart.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });

  btnRestart.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    restartGame();
    btnRestart.blur();
  });

  btnMute.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });

  btnMute.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    updateMuteButton(audio.toggleMute());
    btnMute.blur();
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat) {
      return;
    }

    const key = e.key.toLowerCase();

    if (key === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      audio.unlock();
      restartGame();
      return;
    }

    if (key === 'm' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      audio.unlock();
      updateMuteButton(audio.toggleMute());
      return;
    }

    if (e.key === 'Escape') {
      if (engine.state.aim.active) {
        e.preventDefault();
        engine.cancelAim();
        releaseActivePointer(activePointerId ?? undefined);
      }
      return;
    }

    if (e.code === 'Space' || e.key === 'Enter') {
      if (engine.state.status === 'gameover' && engine.canQuickRestart()) {
        if (e.key === 'Enter' && document.activeElement?.tagName === 'A') {
          return;
        }
        e.preventDefault();
        audio.unlock();
        restartGame();
      }
    }
  });

  // Cancel any in-progress drag if window loses focus
  window.addEventListener('blur', () => {
    if (activePointerId !== null || engine.state.aim.active) {
      engine.cancelAim();
      releaseActivePointer(activePointerId ?? undefined);
    }
  });

  // Viewport resize listeners
  window.addEventListener('resize', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);

  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      handleResize();
    });
    observer.observe(appRoot);
  }

  // Initial setup
  updateMuteButton(audio.isMuted());
  handleResize();
  syncUI(engine.state);

  // Main 60fps render & simulation loop
  let lastTime = performance.now();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      lastTime = performance.now();
    }
  });

  function frame(now: number): void {
    const dt = Math.min(Math.max((now - lastTime) / 1000, 0), 0.1);
    lastTime = now;

    engine.update(dt, renderer.getViewport());
    renderer.render(engine.state);
    syncUI(engine.state);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

bootstrap();
