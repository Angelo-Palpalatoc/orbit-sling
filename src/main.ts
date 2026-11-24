import './style.css';
import { AudioEngine } from './game/audio';
import { GameEngine } from './game/engine';
import {
  ADVENTURE_CHAPTERS,
  ADVENTURE_SECTORS,
  getChapterById,
  getChapterStarCounts,
  getSectorById,
  getSectorsByChapter,
  getTotalAdventureStars,
  getTotalMaxAdventureStars,
} from './game/levels';
import { GameRenderer } from './game/renderer';
import {
  buildFacebookShareUrl,
  buildShareText,
  buildShareUrl,
  buildXShareUrl,
  copyTextToClipboard,
  downloadScoreCard,
  renderScoreCardBlob,
  shareForInstagram,
} from './game/share';
import type { GameMode, GameOverReason, GameState, GameStatus } from './game/types';

const GAME_OVER_COPY: Record<GameOverReason, string> = {
  OUT_OF_SECTOR: 'DRIFTED OUT OF SECTOR',
  ORBIT_DECAYED: 'ANCHOR ORBIT DECAYED',
  DRONE_COLLISION: 'HAZARD DRONE IMPACT',
  REPULSOR_IMPACT: 'REPULSOR CORE IMPACT',
};

const MAX_ADVENTURE_STARS = getTotalMaxAdventureStars();
const SECTORS_PER_PAGE = 10;

interface InitialRoute {
  mode: GameMode;
  sectorId?: number;
  unlockAll: boolean;
  beatScore: number | null;
}

function readInitialRouteFromUrl(): InitialRoute {
  try {
    const params = new URLSearchParams(window.location.search);
    const unlockRaw = import.meta.env.DEV ? params.get('unlock')?.toLowerCase() : undefined;
    const unlockAll =
      import.meta.env.DEV &&
      (unlockRaw === '1' || unlockRaw === 'true' || unlockRaw === 'all');
    const sectorRaw = params.get('sector');
    let parsedSector: number | undefined;
    if (sectorRaw !== null) {
      const parsed = Number.parseInt(sectorRaw, 10);
      if (Number.isFinite(parsed) && parsed >= 1) {
        parsedSector = parsed;
      }
    }
    const beatRaw = params.get('beat');
    let beatScore: number | null = null;
    if (beatRaw !== null) {
      const parsedBeat = Number.parseInt(beatRaw, 10);
      if (Number.isFinite(parsedBeat) && parsedBeat > 0 && parsedBeat <= 99999) {
        beatScore = parsedBeat;
      }
    }

    if (params.get('mode') === 'adventure' || parsedSector !== undefined) {
      return { mode: 'adventure', sectorId: parsedSector, unlockAll, beatScore };
    }
    return { mode: 'endless', unlockAll, beatScore };
  } catch {
    return { mode: 'endless', unlockAll: false, beatScore: null };
  }
}

function syncRouteToUrl(mode: GameMode, sectorId: number): void {
  try {
    const url = new URL(window.location.href);
    if (mode === 'adventure') {
      url.searchParams.set('mode', 'adventure');
      url.searchParams.set('sector', String(sectorId));
    } else {
      url.searchParams.delete('mode');
      url.searchParams.delete('sector');
    }
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Ignore history API restrictions in sandboxed iframes
  }
}

function requireElement<T extends Element>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Required DOM element not found: #${id}`);
  }
  return el as unknown as T;
}

interface SectorPillRef {
  sectorId: number;
  button: HTMLButtonElement;
  codeEl: HTMLElement;
  dots: HTMLElement[];
}

interface UiSnapshot {
  score: number;
  bestDisplay: string;
  combo: number;
  maxCombo: number;
  isNewBest: boolean;
  mode: GameMode | null;
  adventureSectorId: number;
  status: GameStatus | null;
  reason: GameOverReason | null;
  startOverlayVisible: boolean | null;
  aiming: boolean;
}

function bootstrap(): void {
  const appRoot = requireElement<HTMLElement>('app');
  const canvas = requireElement<HTMLCanvasElement>('game-canvas');
  const hudScore = requireElement<HTMLElement>('hud-score');
  const hudBestLabel = requireElement<HTMLElement>('hud-best-label');
  const hudBest = requireElement<HTMLElement>('hud-best');
  const hudCombo = requireElement<HTMLElement>('hud-combo');
  const hudComboVal = requireElement<HTMLElement>('hud-combo-val');
  const hudChallenge = requireElement<HTMLElement>('hud-challenge');
  const hudChallengeLabel = requireElement<HTMLElement>('hud-challenge-label');
  const hudChallengeVal = requireElement<HTMLElement>('hud-challenge-val');
  const btnRestart = requireElement<HTMLButtonElement>('btn-restart');
  const btnMute = requireElement<HTMLButtonElement>('btn-mute');
  const iconSoundOn = requireElement<Element>('icon-sound-on');
  const iconSoundOff = requireElement<Element>('icon-sound-off');

  const startOverlay = requireElement<HTMLElement>('start-overlay');
  const startKicker = requireElement<HTMLElement>('start-kicker');
  const btnModeEndless = requireElement<HTMLButtonElement>('btn-mode-endless');
  const btnModeAdventure = requireElement<HTMLButtonElement>('btn-mode-adventure');
  const adventurePanel = requireElement<HTMLElement>('adventure-panel');
  const btnChapterPrev = requireElement<HTMLButtonElement>('btn-chapter-prev');
  const btnChapterNext = requireElement<HTMLButtonElement>('btn-chapter-next');
  const adventureChapterLabel = requireElement<HTMLElement>('adventure-chapter-label');
  const adventureChapterStars = requireElement<HTMLElement>('adventure-chapter-stars');
  const adventureSectorTitle = requireElement<HTMLElement>('adventure-sector-title');
  const adventureStarsTotal = requireElement<HTMLElement>('adventure-stars-total');
  const adventureSectorSubtitle = requireElement<HTMLElement>('adventure-sector-subtitle');
  const adventureSectorGrid = requireElement<HTMLElement>('adventure-sector-grid');

  const victoryOverlay = requireElement<HTMLElement>('victory-overlay');
  const victoryTitle = requireElement<HTMLElement>('victory-title');
  const victorySubtitle = requireElement<HTMLElement>('victory-subtitle');
  const victoryStars = requireElement<HTMLElement>('victory-stars');
  const victoryStarEls = [
    requireElement<SVGElement>('victory-star-1'),
    requireElement<SVGElement>('victory-star-2'),
    requireElement<SVGElement>('victory-star-3'),
  ];
  const objCleared = requireElement<HTMLElement>('obj-cleared');
  const objShards = requireElement<HTMLElement>('obj-shards');
  const objShardsVal = requireElement<HTMLElement>('obj-shards-val');
  const objCombo = requireElement<HTMLElement>('obj-combo');
  const objComboVal = requireElement<HTMLElement>('obj-combo-val');
  const victoryScore = requireElement<HTMLElement>('victory-score');
  const victoryBest = requireElement<HTMLElement>('victory-best');
  const victoryNewBest = requireElement<HTMLElement>('victory-new-best');
  const btnVictoryNext = requireElement<HTMLButtonElement>('btn-victory-next');
  const btnVictoryNextLabel = requireElement<HTMLElement>('btn-victory-next-label');
  const btnVictoryNextKey = requireElement<HTMLElement>('btn-victory-next-key');
  const btnVictoryReplay = requireElement<HTMLButtonElement>('btn-victory-replay');
  const btnVictoryShare = requireElement<HTMLButtonElement>('btn-victory-share');

  const gameoverOverlay = requireElement<HTMLElement>('gameover-overlay');
  const gameoverReason = requireElement<HTMLElement>('gameover-reason');
  const gameoverMode = requireElement<HTMLElement>('gameover-mode');
  const goScore = requireElement<HTMLElement>('go-score');
  const goBestLabel = requireElement<HTMLElement>('go-best-label');
  const goBest = requireElement<HTMLElement>('go-best');
  const goNewBest = requireElement<HTMLElement>('go-new-best');
  const goMaxCombo = requireElement<HTMLElement>('go-max-combo');
  const btnPlayAgain = requireElement<HTMLButtonElement>('btn-play-again');
  const btnPlayAgainLabel = requireElement<HTMLElement>('btn-play-again-label');
  const btnShare = requireElement<HTMLButtonElement>('btn-share');

  const shareModal = requireElement<HTMLElement>('share-modal');
  const btnShareClose = requireElement<HTMLButtonElement>('btn-share-close');
  const sharePreviewLink = requireElement<HTMLAnchorElement>('share-preview-link');
  const sharePreviewUrl = requireElement<HTMLElement>('share-preview-url');
  const shareCardPreview = requireElement<HTMLImageElement>('share-card-preview');
  const btnShareFb = requireElement<HTMLButtonElement>('btn-share-fb');
  const btnShareIg = requireElement<HTMLButtonElement>('btn-share-ig');
  const btnShareX = requireElement<HTMLButtonElement>('btn-share-x');
  const btnShareCopy = requireElement<HTMLButtonElement>('btn-share-copy');
  const btnShareCopyLabel = requireElement<HTMLElement>('btn-share-copy-label');
  const btnShareDownload = requireElement<HTMLButtonElement>('btn-share-download');
  const shareStatus = requireElement<HTMLElement>('share-status');

  const initialRoute = readInitialRouteFromUrl();
  const audio = new AudioEngine();
  const engine = new GameEngine(
    (event) => {
      audio.handleEvent(event);
    },
    initialRoute.mode,
    initialRoute.sectorId,
    initialRoute.unlockAll
  );
  const renderer = new GameRenderer(canvas);

  if (engine.state.mode === 'adventure') {
    syncRouteToUrl('adventure', engine.state.adventureSectorId);
  }

  let viewedChapterId = getSectorById(engine.state.adventureSectorId).chapterId;

  const sectorPills: SectorPillRef[] = Array.from({ length: SECTORS_PER_PAGE }, (_, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sector-pill';

    const codeEl = document.createElement('span');
    codeEl.className = 'sector-code';
    codeEl.textContent = String(index + 1).padStart(2, '0');

    const starsEl = document.createElement('span');
    starsEl.className = 'sector-stars';
    starsEl.setAttribute('aria-hidden', 'true');

    const dots: HTMLElement[] = [];
    for (let i = 0; i < 3; i += 1) {
      const dot = document.createElement('span');
      dot.className = 'sector-star-dot';
      starsEl.appendChild(dot);
      dots.push(dot);
    }

    button.appendChild(codeEl);
    button.appendChild(starsEl);

    const pillRef: SectorPillRef = { sectorId: index + 1, button, codeEl, dots };

    button.addEventListener('pointerdown', (e: PointerEvent) => {
      e.stopPropagation();
    });
    button.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      if (button.disabled) {
        return;
      }
      audio.unlock();
      selectSector(pillRef.sectorId);
      button.blur();
    });

    adventureSectorGrid.appendChild(button);
    return pillRef;
  });

  const ui: UiSnapshot = {
    score: -1,
    bestDisplay: '',
    combo: -1,
    maxCombo: -1,
    isNewBest: false,
    mode: null,
    adventureSectorId: -1,
    status: null,
    reason: null,
    startOverlayVisible: null,
    aiming: false,
  };

  let activePointerId: number | null = null;
  let shareResetTimer: number | null = null;
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

  const challengeTarget = initialRoute.beatScore;
  const challengeMode = initialRoute.mode;
  const challengeSectorId = initialRoute.sectorId ?? engine.state.adventureSectorId;
  let challengeBeatenShown: boolean | null = null;
  let cachedShareBlob: Blob | null = null;
  let cachedSharePreviewUrl: string | null = null;

  function revokeSharePreview(): void {
    if (cachedSharePreviewUrl) {
      URL.revokeObjectURL(cachedSharePreviewUrl);
      cachedSharePreviewUrl = null;
    }
    cachedShareBlob = null;
    shareCardPreview.removeAttribute('src');
  }

  function resetShareFeedback(): void {
    if (shareResetTimer !== null) {
      window.clearTimeout(shareResetTimer);
      shareResetTimer = null;
    }
    btnShareCopyLabel.textContent = 'Copy Link';
    shareStatus.textContent = '';
  }

  function setShareStatus(message: string, copyBtnLabel?: string): void {
    resetShareFeedback();
    shareStatus.textContent = message;
    if (copyBtnLabel) {
      btnShareCopyLabel.textContent = copyBtnLabel;
    }
    shareResetTimer = window.setTimeout(() => {
      resetShareFeedback();
    }, 2400);
  }

  function closeShareModal(): void {
    if (shareModal.hidden) return;
    shareModal.hidden = true;
    resetShareFeedback();
    revokeSharePreview();
  }

  function openShareModal(): void {
    resetShareFeedback();
    revokeSharePreview();
    const challengeUrl = buildShareUrl(
      engine.state.mode,
      engine.state.adventureSectorId,
      engine.state.score
    );
    sharePreviewLink.href = challengeUrl || window.location.href;
    sharePreviewUrl.textContent = challengeUrl.replace(/^https?:\/\//, '') || window.location.host;
    shareModal.hidden = false;
    void renderScoreCardBlob(engine.state).then((blob) => {
      if (!blob || shareModal.hidden) return;
      cachedShareBlob = blob;
      cachedSharePreviewUrl = URL.createObjectURL(blob);
      shareCardPreview.src = cachedSharePreviewUrl;
    });
  }

  function syncAdventurePanel(activeSectorId: number): void {
    const progress = engine.getAdventureProgress();
    const highestUnlocked = engine.getHighestUnlockedSectorId();
    const totalStars = getTotalAdventureStars(progress);
    const activeSector = getSectorById(activeSectorId);
    const viewedChapter = getChapterById(viewedChapterId);
    const chapterSectors = getSectorsByChapter(viewedChapter.id);
    const chapterStars = getChapterStarCounts(viewedChapter.id, progress);
    const isViewingActiveChapter = viewedChapter.id === activeSector.chapterId;

    adventureChapterLabel.textContent = `CH ${viewedChapter.code} · ${viewedChapter.name}`;
    adventureChapterLabel.dataset.accent = viewedChapter.accent;
    adventureChapterStars.textContent = `★ ${chapterStars.earned}/${chapterStars.max}`;
    adventureChapterStars.setAttribute(
      'aria-label',
      `Chapter ${viewedChapter.code} ${viewedChapter.name}: ${chapterStars.earned} of ${chapterStars.max} stars earned`
    );
    btnChapterPrev.disabled = viewedChapter.id <= 1;
    btnChapterNext.disabled = viewedChapter.id >= ADVENTURE_CHAPTERS.length;
    adventureSectorGrid.setAttribute(
      'aria-label',
      `Chapter ${viewedChapter.code} ${viewedChapter.name} sectors`
    );

    adventureSectorTitle.textContent = `SECTOR ${activeSector.code} · ${activeSector.name}`;
    adventureSectorSubtitle.textContent = isViewingActiveChapter
      ? activeSector.subtitle
      : viewedChapter.tagline;
    adventureSectorSubtitle.classList.toggle('is-preview', !isViewingActiveChapter);
    adventureStarsTotal.textContent = `★ ${totalStars}/${MAX_ADVENTURE_STARS}`;
    adventureStarsTotal.setAttribute(
      'aria-label',
      `${totalStars} of ${MAX_ADVENTURE_STARS} adventure stars earned`
    );

    for (let idx = 0; idx < sectorPills.length; idx += 1) {
      const pill = sectorPills[idx];
      const sector = chapterSectors[idx];
      if (!sector) {
        pill.button.hidden = true;
        continue;
      }

      pill.button.hidden = false;
      pill.sectorId = sector.id;
      pill.codeEl.textContent = sector.code;

      const entry = progress[sector.id];
      const stars = entry?.stars ?? 0;
      const cleared = Boolean(entry?.cleared);
      const locked = sector.id > highestUnlocked;
      const isActive = sector.id === activeSectorId;

      pill.button.disabled = locked;
      pill.button.classList.toggle('is-active', isActive);
      pill.button.classList.toggle('is-cleared', cleared);
      pill.button.classList.toggle('is-locked', locked);
      pill.button.setAttribute('aria-pressed', String(isActive));
      pill.button.title = locked
        ? `Sector ${sector.code} · ${sector.name} (Locked)`
        : `Sector ${sector.code} · ${sector.name} (${stars}/3 stars)`;
      pill.button.setAttribute(
        'aria-label',
        locked
          ? `Sector ${sector.code} ${sector.name}, locked`
          : `Sector ${sector.code} ${sector.name}, ${stars} of 3 stars`
      );

      for (let i = 0; i < pill.dots.length; i += 1) {
        pill.dots[i].classList.toggle('is-earned', i < stars);
      }
    }
  }

  function stepViewedChapter(delta: number): void {
    const nextChapterId = Math.max(
      1,
      Math.min(ADVENTURE_CHAPTERS.length, viewedChapterId + delta)
    );
    if (nextChapterId === viewedChapterId) {
      return;
    }
    viewedChapterId = nextChapterId;
    syncAdventurePanel(engine.state.adventureSectorId);
  }

  function switchMode(mode: GameMode): void {
    releaseActivePointer(activePointerId ?? undefined);
    closeShareModal();
    engine.setMode(mode);
    syncRouteToUrl(engine.state.mode, engine.state.adventureSectorId);
    syncUI(engine.state);
  }

  function selectSector(sectorId: number): void {
    releaseActivePointer(activePointerId ?? undefined);
    closeShareModal();
    engine.selectSector(sectorId);
    syncRouteToUrl(engine.state.mode, engine.state.adventureSectorId);
    syncUI(engine.state);
  }

  function advanceToNextSector(): void {
    releaseActivePointer(activePointerId ?? undefined);
    closeShareModal();
    const advanced = engine.nextSector();
    if (!advanced) {
      engine.reset();
    }
    syncRouteToUrl(engine.state.mode, engine.state.adventureSectorId);
    syncUI(engine.state);
  }

  function restartGame(): void {
    releaseActivePointer(activePointerId ?? undefined);
    closeShareModal();
    engine.reset();
    syncUI(engine.state);
  }

  function syncUI(state: GameState): void {
    const modeChanged = state.mode !== ui.mode;
    const sectorChanged = state.adventureSectorId !== ui.adventureSectorId;
    const statusChanged = state.status !== ui.status;
    const isAdventure = state.mode === 'adventure';

    if (modeChanged || sectorChanged) {
      ui.mode = state.mode;
      ui.adventureSectorId = state.adventureSectorId;

      btnModeEndless.classList.toggle('is-active', !isAdventure);
      btnModeEndless.setAttribute('aria-pressed', String(!isAdventure));
      btnModeAdventure.classList.toggle('is-active', isAdventure);
      btnModeAdventure.setAttribute('aria-pressed', String(isAdventure));

      startOverlay.classList.toggle('is-adventure', isAdventure);
      adventurePanel.hidden = !isAdventure;

      if (isAdventure) {
        const sector = getSectorById(state.adventureSectorId);
        viewedChapterId = sector.chapterId;
        hudBestLabel.textContent = `SECTOR ${sector.code}`;
        goBestLabel.textContent = 'SECTOR BEST';
        btnPlayAgainLabel.textContent = 'Retry Sector';
        startKicker.textContent = `CAMPAIGN // ${ADVENTURE_CHAPTERS.length} CHAPTERS · ${ADVENTURE_SECTORS.length} SECTORS`;
      } else {
        hudBestLabel.textContent = 'BEST';
        goBestLabel.textContent = 'BEST';
        btnPlayAgainLabel.textContent = 'Play Again';
        startKicker.textContent = 'ORBITAL TELEMETRY // ENDLESS';
      }
    }

    if (isAdventure && (modeChanged || sectorChanged || statusChanged)) {
      syncAdventurePanel(state.adventureSectorId);
    }

    if (state.score !== ui.score) {
      ui.score = state.score;
      hudScore.textContent = String(state.score);
    }

    // Challenge target pill when entering via a shared ?beat=N link
    const challengeActive =
      challengeTarget !== null &&
      state.mode === challengeMode &&
      (challengeMode === 'endless' || state.adventureSectorId === challengeSectorId);
    if (challengeActive && challengeTarget !== null) {
      const beaten = state.score > challengeTarget;
      if (hudChallenge.hidden || beaten !== challengeBeatenShown) {
        challengeBeatenShown = beaten;
        hudChallenge.hidden = false;
        hudChallenge.classList.toggle('is-beaten', beaten);
        hudChallengeLabel.textContent = beaten ? 'BEATEN' : 'BEAT';
        hudChallengeVal.textContent = beaten ? `${challengeTarget} ✓` : String(challengeTarget);
      }
    } else if (!hudChallenge.hidden) {
      hudChallenge.hidden = true;
      challengeBeatenShown = null;
    }

    const bestDisplay = isAdventure
      ? `${Math.max(0, state.adventureCurrentAnchorIndex)}/${Math.max(1, state.adventureTotalAnchors)}`
      : String(state.bestScore);
    if (bestDisplay !== ui.bestDisplay) {
      ui.bestDisplay = bestDisplay;
      hudBest.textContent = bestDisplay;
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

    if (statusChanged) {
      ui.status = state.status;
      gameoverOverlay.hidden = state.status !== 'gameover';
      victoryOverlay.hidden = state.status !== 'victory';
    }

    if (state.status === 'victory' && statusChanged) {
      const summary = state.adventureSummary;
      const sector = getSectorById(summary?.sectorId ?? state.adventureSectorId);
      const chapter = getChapterById(sector.chapterId);
      const starsEarned = Math.max(0, Math.min(3, summary?.starsEarned ?? 1));
      const hasNext = Boolean(summary?.hasNextSector);

      victoryTitle.textContent = hasNext
        ? `SECTOR ${sector.code} CLEARED`
        : 'CAMPAIGN COMPLETE';
      victorySubtitle.textContent = `CH ${chapter.code} · ${sector.name}`;
      victoryStars.setAttribute('aria-label', `${starsEarned} of 3 stars earned`);

      for (let i = 0; i < victoryStarEls.length; i += 1) {
        const starEl = victoryStarEls[i];
        starEl.classList.remove('is-earned');
        if (i < starsEarned) {
          // Restart staggered star pop animation cleanly on each victory
          void starEl.getBoundingClientRect();
          starEl.classList.add('is-earned');
        }
      }

      objCleared.classList.toggle('is-complete', summary?.starCleared ?? true);

      const shardsCollected = summary?.shardsCollected ?? state.shardsCollected;
      const shardTarget = summary?.shardTarget ?? 0;
      const totalShards = summary?.totalShards ?? state.adventureTotalShards;
      const shardDenom = shardTarget > 0 ? shardTarget : totalShards;
      objShards.classList.toggle('is-complete', Boolean(summary?.starShards));
      objShardsVal.textContent = `${shardsCollected}/${shardDenom}`;

      const maxCombo = Math.max(1, summary?.maxCombo ?? state.maxCombo);
      const comboTarget = summary?.comboTarget ?? sector.minComboForStar;
      objCombo.classList.toggle('is-complete', Boolean(summary?.starCombo));
      objComboVal.textContent = `x${maxCombo} / x${comboTarget}`;

      victoryScore.textContent = String(state.score);
      victoryBest.textContent = String(state.bestScore);
      victoryNewBest.hidden = !state.isNewBest;

      if (hasNext) {
        const nextSector = getSectorById(sector.id + 1);
        const nextChapter = getChapterById(nextSector.chapterId);
        btnVictoryNextLabel.textContent =
          sector.id === chapter.endSectorId && nextChapter.id !== chapter.id
            ? `Chapter ${nextChapter.code} →`
            : 'Next Sector';
      } else {
        btnVictoryNextLabel.textContent = 'Play Endless';
      }
      btnVictoryNextKey.hidden = false;
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
        gameoverMode.classList.toggle('is-adventure', isAdventure);

        if (isAdventure) {
          const sector = getSectorById(state.adventureSectorId);
          const chapter = getChapterById(sector.chapterId);
          const current = Math.max(0, state.adventureCurrentAnchorIndex);
          const total = Math.max(1, state.adventureTotalAnchors);
          gameoverMode.textContent = `CH ${chapter.code} · SECTOR ${sector.code} · ${sector.name} · ${current}/${total}`;
        } else {
          const orbitsLabel = state.anchorsCaptured === 1 ? '1 ORBIT' : `${state.anchorsCaptured} ORBITS`;
          gameoverMode.textContent = `ENDLESS SECTOR · ${orbitsLabel}`;
        }
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

    if (engine.state.status === 'victory') {
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

  // Prevent canvas drag when interacting anywhere on the Adventure panel
  adventurePanel.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });

  btnChapterPrev.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnChapterPrev.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    stepViewedChapter(-1);
    btnChapterPrev.blur();
  });

  btnChapterNext.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnChapterNext.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    stepViewedChapter(1);
    btnChapterNext.blur();
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

  // Mode toggle buttons (prevent canvas slingshot drag on tap/click)
  btnModeEndless.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnModeEndless.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    switchMode('endless');
    btnModeEndless.blur();
  });

  btnModeAdventure.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnModeAdventure.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    switchMode('adventure');
    btnModeAdventure.blur();
  });

  // Victory buttons
  btnVictoryNext.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnVictoryNext.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    if (engine.state.adventureSummary?.hasNextSector) {
      advanceToNextSector();
    } else {
      switchMode('endless');
    }
    btnVictoryNext.blur();
  });

  btnVictoryReplay.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnVictoryReplay.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    restartGame();
    btnVictoryReplay.blur();
  });

  btnVictoryShare.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnVictoryShare.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    openShareModal();
    btnVictoryShare.blur();
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

  btnShare.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
  });
  btnShare.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    audio.unlock();
    openShareModal();
    btnShare.blur();
  });

  // Share Sheet Modal actions
  shareModal.addEventListener('pointerdown', (e: PointerEvent) => {
    e.stopPropagation();
    const target = e.target as Element | null;
    if (!target?.closest('.share-sheet')) {
      closeShareModal();
    }
  });

  btnShareClose.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    closeShareModal();
  });

  btnShareFb.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    window.open(buildFacebookShareUrl(engine.state), '_blank', 'noopener,noreferrer');
    setShareStatus('Opening Facebook share...');
    btnShareFb.blur();
  });

  btnShareIg.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    void shareForInstagram(engine.state, cachedShareBlob).then((outcome) => {
      if (outcome === 'shared') {
        setShareStatus('Shared + link copied for IG sticker!');
      } else if (outcome === 'saved') {
        setShareStatus('PNG saved + link copied for IG sticker!');
      }
    });
    btnShareIg.blur();
  });

  btnShareX.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    window.open(buildXShareUrl(engine.state), '_blank', 'noopener,noreferrer');
    setShareStatus('Opening X post...');
    btnShareX.blur();
  });

  btnShareCopy.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    void copyTextToClipboard(buildShareText(engine.state)).then((copied) => {
      if (copied) {
        setShareStatus('Copied challenge card & link!', 'Copied ✓');
      }
    });
    btnShareCopy.blur();
  });

  btnShareDownload.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    void downloadScoreCard(engine.state, cachedShareBlob).then((saved) => {
      if (saved) {
        setShareStatus('Saved 1080×1080 PNG card!');
      }
    });
    btnShareDownload.blur();
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
      if (!shareModal.hidden) {
        e.preventDefault();
        closeShareModal();
        return;
      }
      if (engine.state.aim.active) {
        e.preventDefault();
        engine.cancelAim();
        releaseActivePointer(activePointerId ?? undefined);
      }
      return;
    }

    if (!shareModal.hidden) {
      return;
    }

    if (e.code === 'Space' || e.key === 'Enter') {
      const activeTag = document.activeElement?.tagName;
      if (
        (e.key === 'Enter' && (activeTag === 'A' || activeTag === 'BUTTON')) ||
        (e.code === 'Space' && activeTag === 'BUTTON')
      ) {
        return;
      }

      if (engine.state.status === 'victory') {
        e.preventDefault();
        audio.unlock();
        if (engine.state.adventureSummary?.hasNextSector) {
          advanceToNextSector();
        } else {
          switchMode('endless');
        }
        return;
      }

      if (engine.state.status === 'gameover' && engine.canQuickRestart()) {
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
