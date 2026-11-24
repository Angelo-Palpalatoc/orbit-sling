import {
  ADVENTURE_SECTORS,
  getHighestUnlockedSectorId,
  getSectorById,
  loadAdventureProgress,
  saveAdventureProgress,
} from './levels';
import {
  PALETTE,
  PHYSICS,
  type AdventureRunSummary,
  type AimState,
  type Anchor,
  type CameraState,
  type EnergyShard,
  type FloatingText,
  type GameEvent,
  type GameMode,
  type GameOverReason,
  type GameState,
  type HazardDrone,
  type Particle,
  type Probe,
  type RepulsorNode,
  type SectorDefinition,
  type SectorProgress,
  type ShieldArc,
  type Shockwave,
  type TrajectoryPoint,
  type Vec2,
  type ViewportMetrics,
} from './types';

const BEST_SCORE_STORAGE_KEY = 'orbit-sling-best-v1';

function hashSeedString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TUNING = {
  MAX_RAW_DT: 0.05,
  PROBE_RADIUS: 7.5,
  START_CORE_RADIUS: 16,
  START_ORBIT_RADIUS: 46,
  START_CAPTURE_RADIUS: 72,
  START_ORBIT_ANGULAR_SPEED: 1.9,
  GRAVITY_SOFTENING_FACTOR: 2.2,
  GRAVITY_STRENGTH_MIN: 1_850_000,
  GRAVITY_STRENGTH_MAX: 2_250_000,
  DRONE_RADIUS: 6.5,
  DRONE_HITBOX_FORGIVENESS: 2.5,
  SHARD_RADIUS: 8,
  SHARD_PICKUP_BONUS: 6,
  AHEAD_ANCHOR_BUFFER: 9,
  PRUNE_BELOW_CAMERA: 700,
  TRAIL_MAX_AGE: 0.42,
  TRAIL_MAX_POINTS: 42,
  TRAIL_MIN_STEP_SQ: 6.25,
  QUICK_RESTART_DELAY: 0.45,
  CAPTURE_HIT_STOP: 0.045,
  CRASH_HIT_STOP: 0.07,
  DECAY_WARN_THRESHOLD: 0.32,
  CAMERA_LERP_RATE: 6.5,
  ORBIT_RADIUS_BLEND_RATE: 10,
} as const;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shortestAngleDelta(a: number, b: number): number {
  let delta = (a - b) % (Math.PI * 2);
  if (delta > Math.PI) {
    delta -= Math.PI * 2;
  } else if (delta < -Math.PI) {
    delta += Math.PI * 2;
  }
  return delta;
}

function tryDeflectOffShield(
  pos: Vec2,
  vel: Vec2,
  anchorX: number,
  anchorY: number,
  captureRadius: number,
  shieldAngle: number,
  shieldArcSpan: number
): boolean {
  const rx = pos.x - anchorX;
  const ry = pos.y - anchorY;
  const dist = Math.hypot(rx, ry);
  const entryAngle = dist > 1e-4 ? Math.atan2(ry, rx) : shieldAngle;

  if (Math.abs(shortestAngleDelta(entryAngle, shieldAngle)) <= shieldArcSpan * 0.5) {
    const nx = dist > 1e-4 ? rx / dist : Math.cos(shieldAngle);
    const ny = dist > 1e-4 ? ry / dist : Math.sin(shieldAngle);
    const vn = vel.x * nx + vel.y * ny;

    // Guard against interior outward exits (e.g., weak launch crossing behind own shield)
    if (vn > 0 && dist < captureRadius - 14) {
      return false;
    }

    pos.x = anchorX + nx * (captureRadius + 2.5);
    pos.y = anchorY + ny * (captureRadius + 2.5);

    if (vn < 0) {
      vel.x -= 1.88 * vn * nx;
      vel.y -= 1.88 * vn * ny;
    }

    const postVn = vel.x * nx + vel.y * ny;
    if (postVn < 140) {
      const push = 140 - postVn;
      vel.x += nx * push;
      vel.y += ny * push;
    }

    return true;
  }

  return false;
}

function loadBestScore(storageKey: string): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveBestScore(storageKey: string, score: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(storageKey, String(Math.max(0, Math.floor(score))));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
}

function createEmptyAim(): AimState {
  return {
    active: false,
    startScreen: { x: 0, y: 0 },
    currentScreen: { x: 0, y: 0 },
    power: 0,
    valid: false,
    launchVelocity: { x: 0, y: 0 },
    trajectory: [],
    lockedAnchorId: null,
    hitsHazard: false,
    deflectsOffShield: false,
  };
}

function createInitialCamera(): CameraState {
  return {
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    shakeMagnitude: 0,
    shakeOffsetX: 0,
    shakeOffsetY: 0,
  };
}

/**
 * Semi-implicit Euler gravity integration step shared identically by live probe
 * free-flight and the slingshot trajectory preview predictor.
 */
export function stepGravityFlight(
  pos: Vec2,
  vel: Vec2,
  anchors: readonly Anchor[],
  launchAnchorId: number | null,
  flightTime: number,
  dt: number,
  anchorXOverrides?: readonly number[],
  repulsors?: readonly RepulsorNode[]
): void {
  for (let i = 0; i < anchors.length; i++) {
    const anchor = anchors[i];
    if (anchor.id === launchAnchorId && flightTime < PHYSICS.LAUNCH_GRACE_TIME) {
      continue;
    }

    const anchorX = anchorXOverrides ? anchorXOverrides[i] : anchor.x;
    const dx = anchorX - pos.x;
    const dy = anchor.y - pos.y;
    const distSq = dx * dx + dy * dy;
    const dist = Math.sqrt(distSq);

    if (dist > 1e-6 && dist < anchor.gravityRange) {
      const softening = anchor.coreRadius * TUNING.GRAVITY_SOFTENING_FACTOR;
      const accel = anchor.gravityStrength / (distSq + softening * softening);
      const invDist = 1 / dist;
      vel.x += dx * invDist * accel * dt;
      vel.y += dy * invDist * accel * dt;
    }
  }

  if (repulsors) {
    for (let i = 0; i < repulsors.length; i++) {
      const repulsor = repulsors[i];
      const dx = repulsor.x - pos.x;
      const dy = repulsor.y - pos.y;
      const distSq = dx * dx + dy * dy;
      const dist = Math.sqrt(distSq);

      if (dist > 1e-6 && dist < repulsor.range) {
        const softening = repulsor.coreRadius * 2.4;
        const accel = repulsor.strength / (distSq + softening * softening);
        const invDist = 1 / dist;
        vel.x -= dx * invDist * accel * dt;
        vel.y -= dy * invDist * accel * dt;
      }
    }
  }

  pos.x += vel.x * dt;
  pos.y += vel.y * dt;
}

export class GameEngine {
  readonly state: GameState;

  private readonly onEvent?: (event: GameEvent) => void;
  private nextEntityId = 1;
  private highestVisitedIndex = 0;
  private physicsAccumulator = 0;
  private decayWarnCooldown = 0;
  private currentMaxPullPx: number = PHYSICS.MAX_PULL_PX;
  private readonly previewAnchorX: number[] = [];
  private endlessBestScore = 0;
  private adventureProgress: Record<number, SectorProgress>;
  private readonly unlockAllSectors: boolean;
  private levelRng: () => number = Math.random;

  constructor(
    onEvent?: (event: GameEvent) => void,
    initialMode: GameMode = 'endless',
    initialSectorId?: number,
    unlockAllSectors = false
  ) {
    this.onEvent = onEvent;
    this.unlockAllSectors = unlockAllSectors;
    this.adventureProgress = loadAdventureProgress();
    const highestUnlocked = this.getHighestUnlockedSectorId();
    const defaultSectorId = unlockAllSectors ? 1 : highestUnlocked;
    const resolvedSectorId =
      initialSectorId !== undefined
        ? clamp(Math.floor(initialSectorId), 1, highestUnlocked)
        : defaultSectorId;
    this.endlessBestScore = loadBestScore(BEST_SCORE_STORAGE_KEY);
    const initialBest =
      initialMode === 'adventure'
        ? (this.adventureProgress[resolvedSectorId]?.bestScore ?? 0)
        : this.endlessBestScore;

    this.state = this.createBlankState(initialMode, resolvedSectorId, initialBest);
    this.reset();
  }

  setMode(mode: GameMode, sectorId?: number): void {
    if (mode === 'adventure') {
      const highestUnlocked = this.getHighestUnlockedSectorId();
      const targetSectorId = clamp(
        Math.floor(sectorId ?? (this.state.adventureSectorId || highestUnlocked)),
        1,
        highestUnlocked
      );
      if (
        this.state.mode === 'adventure' &&
        this.state.status === 'ready' &&
        this.state.adventureSectorId === targetSectorId
      ) {
        return;
      }
      this.state.mode = 'adventure';
      this.state.adventureSectorId = targetSectorId;
      this.reset();
      return;
    }

    if (this.state.mode === mode && this.state.status === 'ready') {
      return;
    }
    this.state.mode = mode;
    this.reset();
  }

  selectSector(sectorId: number): void {
    const highestUnlocked = this.getHighestUnlockedSectorId();
    const clamped = clamp(Math.floor(sectorId), 1, highestUnlocked);
    this.state.mode = 'adventure';
    this.state.adventureSectorId = clamped;
    this.reset();
  }

  nextSector(): boolean {
    const nextId = this.state.adventureSectorId + 1;
    if (
      this.state.adventureSectorId < ADVENTURE_SECTORS.length &&
      nextId <= this.getHighestUnlockedSectorId()
    ) {
      this.selectSector(nextId);
      return true;
    }
    return false;
  }

  getAdventureProgress(): Record<number, SectorProgress> {
    const copy: Record<number, SectorProgress> = {};
    for (const sector of ADVENTURE_SECTORS) {
      const entry = this.adventureProgress[sector.id];
      if (entry) {
        copy[sector.id] = { ...entry };
      }
    }
    return copy;
  }

  getHighestUnlockedSectorId(): number {
    return this.unlockAllSectors
      ? ADVENTURE_SECTORS.length
      : getHighestUnlockedSectorId(this.adventureProgress);
  }

  private createBlankState(
    mode: GameMode,
    adventureSectorId: number,
    bestScore: number
  ): GameState {
    const startProbe: Probe = {
      x: 0,
      y: -TUNING.START_ORBIT_RADIUS,
      vx: 0,
      vy: 0,
      radius: TUNING.PROBE_RADIUS,
      mode: 'orbiting',
      anchorId: null,
      launchAnchorId: null,
      flightTime: 0,
      orbitAngle: -Math.PI * 0.5,
      orbitAngularSpeed: TUNING.START_ORBIT_ANGULAR_SPEED,
      orbitDirection: 1,
      orbitRadiusCurrent: TUNING.START_ORBIT_RADIUS,
      trail: [],
    };

    return {
      status: 'ready',
      mode,
      score: 0,
      bestScore,
      isNewBest: false,
      combo: 0,
      maxCombo: 0,
      anchorsCaptured: 0,
      shardsCollected: 0,
      runTrace: [],
      adventureSectorId,
      adventureTotalAnchors: 0,
      adventureCurrentAnchorIndex: 0,
      adventureTotalShards: 0,
      adventureSummary: null,
      gameOverReason: null,
      gameOverElapsed: 0,
      elapsed: 0,
      hitStopRemaining: 0,
      probe: startProbe,
      anchors: [],
      repulsors: [],
      shards: [],
      particles: [],
      shockwaves: [],
      floatingTexts: [],
      aim: createEmptyAim(),
      camera: createInitialCamera(),
    };
  }

  reset(): void {
    const isAdventure = this.state.mode === 'adventure';
    let activeSector: SectorDefinition | null = null;

    if (isAdventure) {
      const highestUnlocked = this.getHighestUnlockedSectorId();
      const clampedSectorId = clamp(Math.floor(this.state.adventureSectorId), 1, highestUnlocked);
      this.state.adventureSectorId = clampedSectorId;
      activeSector = getSectorById(clampedSectorId);
      // Dedicated deterministic PRNG stream for Adventure sectors (isolated from cosmetic VFX)
      this.levelRng = createSeededRng(
        hashSeedString(`orbit-sling-adventure:${activeSector.seed}`)
      );
      this.state.bestScore = this.adventureProgress[activeSector.id]?.bestScore ?? 0;
    } else {
      this.levelRng = Math.random;
      this.endlessBestScore = Math.max(
        this.endlessBestScore,
        loadBestScore(BEST_SCORE_STORAGE_KEY)
      );
      this.state.bestScore = this.endlessBestScore;
    }

    this.nextEntityId = 1;
    this.highestVisitedIndex = 0;
    this.physicsAccumulator = 0;
    this.decayWarnCooldown = 0;
    this.currentMaxPullPx = PHYSICS.MAX_PULL_PX;

    this.state.status = 'ready';
    this.state.score = 0;
    this.state.isNewBest = false;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.anchorsCaptured = 0;
    this.state.shardsCollected = 0;
    this.state.adventureTotalAnchors = 0;
    this.state.adventureCurrentAnchorIndex = 0;
    this.state.adventureTotalShards = 0;
    this.state.adventureSummary = null;
    this.state.gameOverReason = null;
    this.state.gameOverElapsed = 0;
    this.state.elapsed = 0;
    this.state.hitStopRemaining = 0;

    this.state.anchors.length = 0;
    this.state.repulsors.length = 0;
    this.state.shards.length = 0;
    this.state.runTrace.length = 0;
    this.state.particles.length = 0;
    this.state.shockwaves.length = 0;
    this.state.floatingTexts.length = 0;

    this.clearAim();

    this.state.camera.x = 0;
    this.state.camera.y = 0;
    this.state.camera.targetX = 0;
    this.state.camera.targetY = 0;
    this.state.camera.shakeMagnitude = 0;
    this.state.camera.shakeOffsetX = 0;
    this.state.camera.shakeOffsetY = 0;

    const startAnchor: Anchor = {
      id: this.allocateId(),
      index: 0,
      x: 0,
      y: 0,
      baseX: 0,
      baseY: 0,
      coreRadius: TUNING.START_CORE_RADIUS,
      orbitRadius: TUNING.START_ORBIT_RADIUS,
      captureRadius: TUNING.START_CAPTURE_RADIUS,
      gravityStrength: 2_000_000,
      gravityRange: 270,
      driftAmplitude: 0,
      driftSpeed: 0,
      driftPhase: 0,
      hasDecay: false,
      decayDuration: 0,
      decayRemaining: 0,
      decayActive: false,
      visited: true,
      isGoal: false,
      boostMultiplier: 1.0,
      shield: null,
      capturePulse: 0,
      deflectPulse: 0,
      drones: [],
    };
    this.state.anchors.push(startAnchor);

    const startAngle = -Math.PI * 0.5;
    const probe = this.state.probe;
    probe.mode = 'orbiting';
    probe.anchorId = startAnchor.id;
    probe.launchAnchorId = null;
    probe.flightTime = 0;
    probe.radius = TUNING.PROBE_RADIUS;
    probe.orbitDirection = 1;
    probe.orbitAngularSpeed = TUNING.START_ORBIT_ANGULAR_SPEED;
    probe.orbitAngle = startAngle;
    probe.orbitRadiusCurrent = startAnchor.orbitRadius;
    probe.x = startAnchor.x + Math.cos(startAngle) * startAnchor.orbitRadius;
    probe.y = startAnchor.y + Math.sin(startAngle) * startAnchor.orbitRadius;
    probe.vx = -Math.sin(startAngle) * probe.orbitAngularSpeed * startAnchor.orbitRadius;
    probe.vy = Math.cos(startAngle) * probe.orbitAngularSpeed * startAnchor.orbitRadius;
    probe.trail.length = 0;

    // Seed a subtle short orbiting tail on frame 0 so the ready screen immediately feels alive
    const seedCount = 10;
    const seedStepTime = 0.028;
    for (let i = seedCount; i >= 1; i--) {
      const age = i * seedStepTime;
      const pastAngle = startAngle - probe.orbitAngularSpeed * age;
      probe.trail.push({
        x: startAnchor.x + Math.cos(pastAngle) * startAnchor.orbitRadius,
        y: startAnchor.y + Math.sin(pastAngle) * startAnchor.orbitRadius,
        age,
      });
    }

    if (activeSector) {
      for (let i = 1; i <= activeSector.anchorCount; i++) {
        this.spawnAdventureAnchor(activeSector, i);
      }
      this.state.adventureTotalAnchors = activeSector.anchorCount;
      this.state.adventureCurrentAnchorIndex = 0;
      this.state.adventureTotalShards = this.state.shards.length;
      this.state.adventureSummary = null;
    } else {
      this.ensureAnchorsAhead();
    }
  }

  canQuickRestart(): boolean {
    return (
      this.state.status === 'gameover' &&
      this.state.gameOverElapsed >= TUNING.QUICK_RESTART_DELAY
    );
  }

  beginAim(screenX: number, screenY: number, viewport: ViewportMetrics): void {
    if (
      this.state.status === 'gameover' ||
      this.state.status === 'victory' ||
      this.state.probe.mode !== 'orbiting'
    ) {
      return;
    }

    this.currentMaxPullPx = this.computeMaxPullPx(viewport);

    const aim = this.state.aim;
    aim.active = true;
    aim.startScreen.x = screenX;
    aim.startScreen.y = screenY;
    aim.currentScreen.x = screenX;
    aim.currentScreen.y = screenY;
    aim.power = 0;
    aim.valid = false;
    aim.launchVelocity.x = 0;
    aim.launchVelocity.y = 0;
    aim.trajectory.length = 0;
    aim.lockedAnchorId = null;
    aim.hitsHazard = false;
    aim.deflectsOffShield = false;
  }

  updateAim(screenX: number, screenY: number, viewport: ViewportMetrics): void {
    const aim = this.state.aim;
    if (
      !aim.active ||
      this.state.status === 'gameover' ||
      this.state.status === 'victory' ||
      this.state.probe.mode !== 'orbiting'
    ) {
      return;
    }

    this.currentMaxPullPx = this.computeMaxPullPx(viewport);
    aim.currentScreen.x = screenX;
    aim.currentScreen.y = screenY;

    this.recomputeAimVectorAndTrajectory();
  }

  releaseAim(): boolean {
    const aim = this.state.aim;
    const probe = this.state.probe;

    if (
      !aim.active ||
      !aim.valid ||
      this.state.status === 'gameover' ||
      this.state.status === 'victory' ||
      probe.mode !== 'orbiting'
    ) {
      this.clearAim();
      return false;
    }

    // Recompute once right at release so launch velocity matches the probe's exact instant
    this.recomputeAimVectorAndTrajectory();
    if (!aim.valid) {
      this.clearAim();
      return false;
    }

    if (this.state.status === 'ready') {
      this.state.status = 'playing';
    }

    const power = aim.power;
    const launchVx = aim.launchVelocity.x;
    const launchVy = aim.launchVelocity.y;

    const launchAnchor = this.findAnchorById(probe.anchorId);
    const boost = launchAnchor ? launchAnchor.boostMultiplier : 1.0;
    const boosted = boost > 1.05;
    if (launchAnchor) {
      launchAnchor.decayActive = false;
    }

    probe.mode = 'flying';
    probe.launchAnchorId = probe.anchorId;
    probe.anchorId = null;
    probe.flightTime = 0;
    probe.vx = launchVx;
    probe.vy = launchVy;

    this.decayWarnCooldown = 0;
    this.clearAim();

    this.spawnLaunchParticles(probe.x, probe.y, launchVx, launchVy, power, boosted);
    if (boosted) {
      this.addCameraShake(1.8);
    }
    this.emit({ type: 'launch', power, boosted });
    return true;
  }

  cancelAim(): void {
    this.clearAim();
  }

  update(rawDt: number, viewport: ViewportMetrics): void {
    const dt = clamp(Number.isFinite(rawDt) ? rawDt : 0, 0, TUNING.MAX_RAW_DT);
    if (dt <= 0) return;

    this.currentMaxPullPx = this.computeMaxPullPx(viewport);

    if (this.state.status === 'gameover') {
      this.state.gameOverElapsed += dt;
    }

    // Always animate visual juice, camera, and pulse decay even during hit-stop or game over
    this.updateParticles(dt);
    this.updateShockwaves(dt);
    this.updateFloatingTexts(dt);
    this.updateAnchorPulsesAndShards(dt);
    this.updateCamera(dt);

    if (this.state.hitStopRemaining > 0) {
      this.state.hitStopRemaining = Math.max(0, this.state.hitStopRemaining - dt);
      return;
    }

    if (this.state.status === 'gameover') {
      // Let ambient motion (drifting anchors & drones) continue gently behind the game-over overlay
      this.advanceWorldBodies(dt * 0.35);
      this.ageTrail(dt);
      return;
    }

    if (this.state.status === 'victory') {
      // Keep probe gently orbiting the Extraction anchor behind the Victory overlay
      const gentleDt = dt * 0.55;
      this.advanceWorldBodies(gentleDt);
      this.stepOrbitingProbe(gentleDt);
      this.ageTrail(gentleDt);
      this.recordTrailPoint(this.state.probe.x, this.state.probe.y);
      return;
    }

    const probe = this.state.probe;
    const isAimSlowMo = this.state.aim.active && probe.mode === 'orbiting';
    const simScale = isAimSlowMo ? PHYSICS.AIM_TIME_SCALE : 1;
    const scaledDt = dt * simScale;

    this.physicsAccumulator += scaledDt;
    const maxSubsteps = 12;
    let steps = 0;

    while (this.physicsAccumulator >= PHYSICS.FIXED_DT && steps < maxSubsteps) {
      this.physicsAccumulator -= PHYSICS.FIXED_DT;
      steps++;

      const stopLoop = this.stepFixedSimulation(PHYSICS.FIXED_DT, viewport);
      if (stopLoop) {
        this.physicsAccumulator = 0;
        break;
      }
    }

    // Prevent runaway accumulator if hit-stop or slow frames occur
    if (this.physicsAccumulator > PHYSICS.FIXED_DT * 4) {
      this.physicsAccumulator = PHYSICS.FIXED_DT;
    }

    this.ageTrail(dt * (isAimSlowMo ? 0.55 : 1));
    if (probe.mode === 'orbiting' || probe.mode === 'flying') {
      this.recordTrailPoint(probe.x, probe.y);
    }

    if (this.state.aim.active && this.state.aim.valid && probe.mode === 'orbiting') {
      this.recomputeAimVectorAndTrajectory();
    }
  }

  private stepFixedSimulation(dt: number, viewport: ViewportMetrics): boolean {
    this.advanceWorldBodies(dt);

    const probe = this.state.probe;

    if (probe.mode === 'orbiting') {
      return this.stepOrbitingProbe(dt);
    }

    if (probe.mode === 'flying') {
      return this.stepFlyingProbe(dt, viewport);
    }

    return false;
  }

  private advanceWorldBodies(dt: number): void {
    this.state.elapsed += dt;
    const anchors = this.state.anchors;

    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.driftAmplitude > 0) {
        anchor.x =
          anchor.baseX +
          Math.sin(this.state.elapsed * anchor.driftSpeed + anchor.driftPhase) *
            anchor.driftAmplitude;
      }

      if (anchor.shield) {
        anchor.shield.angle += anchor.shield.angularSpeed * dt;
      }

      const drones = anchor.drones;
      for (let j = 0; j < drones.length; j++) {
        const drone = drones[j];
        drone.angle += drone.angularSpeed * dt;
        drone.x = anchor.x + Math.cos(drone.angle) * drone.orbitRadius;
        drone.y = anchor.y + Math.sin(drone.angle) * drone.orbitRadius;
      }
    }
  }

  private stepOrbitingProbe(dt: number): boolean {
    const probe = this.state.probe;
    const anchor = this.findAnchorById(probe.anchorId);
    if (!anchor) {
      return false;
    }

    probe.orbitAngle += probe.orbitAngularSpeed * dt;
    const blend = 1 - Math.exp(-TUNING.ORBIT_RADIUS_BLEND_RATE * dt);
    probe.orbitRadiusCurrent += (anchor.orbitRadius - probe.orbitRadiusCurrent) * blend;

    const cosA = Math.cos(probe.orbitAngle);
    const sinA = Math.sin(probe.orbitAngle);
    probe.x = anchor.x + cosA * probe.orbitRadiusCurrent;
    probe.y = anchor.y + sinA * probe.orbitRadiusCurrent;
    probe.vx = -sinA * probe.orbitAngularSpeed * probe.orbitRadiusCurrent;
    probe.vy = cosA * probe.orbitAngularSpeed * probe.orbitRadiusCurrent;

    if (anchor.hasDecay && anchor.decayActive) {
      anchor.decayRemaining -= dt;
      if (anchor.decayRemaining <= 0) {
        anchor.decayRemaining = 0;
        this.triggerCrash('ORBIT_DECAYED', anchor);
        return true;
      }

      const ratio = anchor.decayRemaining / Math.max(0.001, anchor.decayDuration);
      if (ratio < TUNING.DECAY_WARN_THRESHOLD) {
        const urgency = clamp(
          (TUNING.DECAY_WARN_THRESHOLD - ratio) / TUNING.DECAY_WARN_THRESHOLD,
          0,
          1
        );
        this.decayWarnCooldown -= dt;
        if (this.decayWarnCooldown <= 0) {
          this.emit({ type: 'decayWarning', urgency });
          this.decayWarnCooldown = lerp(0.45, 0.22, urgency);
        }
      }
    }

    return false;
  }

  private stepFlyingProbe(dt: number, viewport: ViewportMetrics): boolean {
    const probe = this.state.probe;
    const pos: Vec2 = { x: probe.x, y: probe.y };
    const vel: Vec2 = { x: probe.vx, y: probe.vy };

    stepGravityFlight(
      pos,
      vel,
      this.state.anchors,
      probe.launchAnchorId,
      probe.flightTime,
      dt,
      undefined,
      this.state.repulsors
    );

    probe.x = pos.x;
    probe.y = pos.y;
    probe.vx = vel.x;
    probe.vy = vel.y;
    probe.flightTime += dt;

    // 1. Hazard drone & repulsor core collision checks first
    if (this.checkDroneCollision(probe)) {
      this.triggerCrash('DRONE_COLLISION', null);
      return true;
    }

    if (this.checkRepulsorCollision(probe)) {
      this.triggerCrash('REPULSOR_IMPACT', null);
      return true;
    }

    // 2. Energy shard collection
    this.checkShardCollection(probe);

    // 3. Anchor capture / rotating shield deflection check
    const capturedAnchor = this.findCapturedAnchor(probe);
    if (capturedAnchor) {
      if (capturedAnchor.shield) {
        const probePos: Vec2 = { x: probe.x, y: probe.y };
        const probeVel: Vec2 = { x: probe.vx, y: probe.vy };
        if (
          tryDeflectOffShield(
            probePos,
            probeVel,
            capturedAnchor.x,
            capturedAnchor.y,
            capturedAnchor.captureRadius,
            capturedAnchor.shield.angle,
            capturedAnchor.shield.arcSpan
          )
        ) {
          probe.x = probePos.x;
          probe.y = probePos.y;
          probe.vx = probeVel.x;
          probe.vy = probeVel.y;
          capturedAnchor.deflectPulse = 1.0;
          if (this.state.runTrace.length < 64) {
            this.state.runTrace.push('deflect');
          }
          this.addCameraShake(4.0);
          this.spawnBurstParticles(
            probe.x,
            probe.y,
            12,
            PALETTE.coral,
            PALETTE.coralSoft,
            65,
            195
          );
          this.spawnShockwave(probe.x, probe.y, 46, PALETTE.coralSoft, 0.3, 2.2);
          this.emit({ type: 'deflect' });
        } else {
          this.handleAnchorCapture(capturedAnchor);
          return true;
        }
      } else {
        this.handleAnchorCapture(capturedAnchor);
        return true;
      }
    }

    // 4. Out-of-sector bounds check
    if (this.isOutOfSector(probe, viewport)) {
      this.triggerCrash('OUT_OF_SECTOR', null);
      return true;
    }

    return false;
  }

  private checkRepulsorCollision(probe: Probe): boolean {
    const repulsors = this.state.repulsors;
    for (let i = 0; i < repulsors.length; i++) {
      const repulsor = repulsors[i];
      const hitRadius = Math.max(2, probe.radius + repulsor.coreRadius - 1.5);
      const dx = probe.x - repulsor.x;
      const dy = probe.y - repulsor.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return true;
      }
    }
    return false;
  }

  private checkDroneCollision(probe: Probe): boolean {
    const anchors = this.state.anchors;
    for (let i = 0; i < anchors.length; i++) {
      const drones = anchors[i].drones;
      for (let j = 0; j < drones.length; j++) {
        const drone = drones[j];
        const hitRadius = Math.max(2, probe.radius + drone.radius - TUNING.DRONE_HITBOX_FORGIVENESS);
        const dx = probe.x - drone.x;
        const dy = probe.y - drone.y;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          return true;
        }
      }
    }
    return false;
  }

  private checkShardCollection(probe: Probe): void {
    const shards = this.state.shards;
    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      if (shard.collected) continue;

      const pickupRadius = probe.radius + shard.radius + TUNING.SHARD_PICKUP_BONUS;
      const dx = probe.x - shard.x;
      const dy = probe.y - shard.y;
      if (dx * dx + dy * dy <= pickupRadius * pickupRadius) {
        shard.collected = true;
        this.state.shardsCollected += 1;
        const points = Math.max(1, this.state.combo) * shard.value;
        this.addScore(points);

        this.spawnBurstParticles(shard.x, shard.y, 12, PALETTE.gold, PALETTE.goldSoft, 70, 185);
        this.spawnShockwave(shard.x, shard.y, 44, PALETTE.goldSoft, 0.32, 2);
        this.spawnFloatingText(shard.x, shard.y - 10, `+${points}`, PALETTE.gold, 1.0);

        this.emit({ type: 'shard', combo: this.state.combo, points });
      }
    }
  }

  private findCapturedAnchor(probe: Probe): Anchor | null {
    const anchors = this.state.anchors;
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.id === probe.launchAnchorId && probe.flightTime < PHYSICS.LAUNCH_GRACE_TIME) {
        continue;
      }

      const dx = probe.x - anchor.x;
      const dy = probe.y - anchor.y;
      if (dx * dx + dy * dy <= anchor.captureRadius * anchor.captureRadius) {
        return anchor;
      }
    }
    return null;
  }

  private handleAnchorCapture(anchor: Anchor): void {
    const probe = this.state.probe;
    const rx = probe.x - anchor.x;
    const ry = probe.y - anchor.y;
    const dist = Math.hypot(rx, ry);

    const cross = rx * probe.vy - ry * probe.vx;
    const orbitDirection: 1 | -1 = cross >= 0 ? 1 : -1;
    const angularSpeed =
      TUNING.START_ORBIT_ANGULAR_SPEED +
      Math.max(0, TUNING.START_ORBIT_RADIUS - anchor.orbitRadius) * 0.032;

    probe.mode = 'orbiting';
    probe.anchorId = anchor.id;
    probe.launchAnchorId = null;
    probe.flightTime = 0;
    probe.orbitDirection = orbitDirection;
    probe.orbitAngularSpeed = orbitDirection * angularSpeed;
    probe.orbitAngle = dist > 1e-4 ? Math.atan2(ry, rx) : -Math.PI * 0.5;
    probe.orbitRadiusCurrent = Math.max(anchor.coreRadius + probe.radius + 4, dist);

    anchor.capturePulse = 1.0;
    this.decayWarnCooldown = 0;

    if (this.state.mode === 'adventure') {
      this.state.adventureCurrentAnchorIndex = Math.max(
        this.state.adventureCurrentAnchorIndex,
        anchor.index
      );
    }

    if (!anchor.visited) {
      const skipped = Math.max(0, anchor.index - this.highestVisitedIndex - 1);
      anchor.visited = true;
      if (anchor.index > this.highestVisitedIndex) {
        this.highestVisitedIndex = anchor.index;
      }

      this.state.anchorsCaptured += 1;
      if (this.state.runTrace.length < 64) {
        this.state.runTrace.push(
          anchor.isGoal
            ? 'goal'
            : skipped > 0
              ? 'skip'
              : anchor.boostMultiplier > 1.05
                ? 'boost'
                : 'capture'
        );
      }
      this.state.combo += 1 + skipped;
      this.state.maxCombo = Math.max(this.state.maxCombo, this.state.combo);

      const points = this.state.combo + skipped * 2;
      this.addScore(points);

      anchor.decayActive = anchor.hasDecay;

      this.state.hitStopRemaining = TUNING.CAPTURE_HIT_STOP;
      this.addCameraShake(skipped > 0 ? 6.8 : 5.5);

      const accent = skipped > 0 ? PALETTE.gold : PALETTE.cyan;
      const accentSoft = skipped > 0 ? PALETTE.goldSoft : PALETTE.cyanSoft;

      this.spawnShockwave(anchor.x, anchor.y, anchor.captureRadius * 1.48, accent, 0.42, 2.8);
      this.spawnBurstParticles(probe.x, probe.y, skipped > 0 ? 22 : 16, accent, accentSoft, 75, 220);

      const label = skipped > 0 ? `SKIP +${points}` : `+${points}`;
      const scale = skipped > 0 ? 1.2 : this.state.combo >= 4 ? 1.08 : 1.0;
      this.spawnFloatingText(anchor.x, anchor.y - anchor.captureRadius * 0.55, label, accent, scale);

      this.emit({
        type: 'capture',
        combo: this.state.combo,
        points,
        skipped,
        isNewAnchor: true,
      });

      if (this.state.mode === 'adventure' && anchor.isGoal) {
        this.triggerVictory(anchor);
        return;
      }

      this.ensureAnchorsAhead();
      this.pruneBehindCamera();
    } else {
      // Returning to an already-visited anchor resets streak cleanly and grants fair recovery decay
      this.state.combo = 0;
      if (anchor.hasDecay) {
        anchor.decayActive = true;
        anchor.decayRemaining = Math.max(
          anchor.decayRemaining,
          Math.min(anchor.decayDuration, 3.0)
        );
      }
      this.addCameraShake(2.5);
      this.spawnShockwave(anchor.x, anchor.y, anchor.captureRadius * 1.15, PALETTE.cyanSoft, 0.3, 1.8);
      this.spawnBurstParticles(probe.x, probe.y, 8, PALETTE.cyanSoft, PALETTE.white, 45, 130);

      this.emit({
        type: 'capture',
        combo: this.state.combo,
        points: 0,
        skipped: 0,
        isNewAnchor: false,
      });
    }
  }

  private triggerVictory(anchor: Anchor): void {
    if (this.state.status === 'victory') return;

    const sector = getSectorById(this.state.adventureSectorId);
    this.state.status = 'victory';
    this.clearAim();

    const starCleared = true;
    const totalShards = this.state.adventureTotalShards;
    const shardTarget =
      totalShards === 0 ? 0 : Math.max(1, Math.ceil(totalShards * sector.shardStarRatio));
    const starShards = totalShards === 0 ? true : this.state.shardsCollected >= shardTarget;
    const starCombo = this.state.maxCombo >= sector.minComboForStar;
    const starsEarned = 1 + (starShards ? 1 : 0) + (starCombo ? 1 : 0);

    const prevProgress = this.adventureProgress[sector.id];
    const prevBest = prevProgress?.bestScore ?? 0;
    const nextBest = Math.max(prevBest, this.state.bestScore, this.state.score);
    if (this.state.score > prevBest && !this.state.isNewBest) {
      this.state.isNewBest = true;
    }
    this.state.bestScore = nextBest;

    this.adventureProgress[sector.id] = {
      cleared: true,
      stars: Math.max(prevProgress?.stars ?? 0, starsEarned),
      bestScore: nextBest,
    };
    saveAdventureProgress(this.adventureProgress);

    const summary: AdventureRunSummary = {
      sectorId: sector.id,
      sectorCode: sector.code,
      sectorName: sector.name,
      starsEarned,
      starCleared,
      starShards,
      starCombo,
      shardsCollected: this.state.shardsCollected,
      totalShards,
      shardTarget,
      maxCombo: this.state.maxCombo,
      comboTarget: sector.minComboForStar,
      hasNextSector: sector.id < ADVENTURE_SECTORS.length,
    };
    this.state.adventureSummary = summary;

    this.state.hitStopRemaining = 0.055;
    this.addCameraShake(6.5);
    this.spawnShockwave(anchor.x, anchor.y, anchor.captureRadius * 1.9, PALETTE.gold, 0.58, 3.2);
    this.spawnShockwave(anchor.x, anchor.y, anchor.captureRadius * 1.4, PALETTE.cyan, 0.44, 2.4);
    this.spawnBurstParticles(anchor.x, anchor.y, 30, PALETTE.gold, PALETTE.cyan, 85, 250);
    this.spawnFloatingText(
      anchor.x,
      anchor.y - anchor.captureRadius * 0.92,
      'EXTRACTED!',
      PALETTE.gold,
      1.3
    );

    this.emit({ type: 'victory', sectorId: sector.id, stars: starsEarned });
  }

  private triggerCrash(reason: GameOverReason, decayingAnchor: Anchor | null): void {
    if (this.state.status === 'gameover' || this.state.status === 'victory') return;

    this.state.status = 'gameover';
    this.state.probe.mode = 'crashed';
    if (this.state.runTrace.length < 64) {
      this.state.runTrace.push('crash');
    }
    this.state.gameOverReason = reason;
    this.state.gameOverElapsed = 0;
    this.state.hitStopRemaining = TUNING.CRASH_HIT_STOP;
    this.clearAim();

    const probe = this.state.probe;
    const shake = reason === 'OUT_OF_SECTOR' ? 8 : 11;
    this.addCameraShake(shake);

    this.spawnBurstParticles(probe.x, probe.y, 26, PALETTE.coral, PALETTE.coralSoft, 85, 290);
    this.spawnShockwave(probe.x, probe.y, 88, PALETTE.coral, 0.48, 3.2);

    if (reason === 'ORBIT_DECAYED' && decayingAnchor) {
      this.spawnBurstParticles(
        decayingAnchor.x,
        decayingAnchor.y,
        20,
        PALETTE.coral,
        PALETTE.gold,
        60,
        240
      );
      this.spawnShockwave(
        decayingAnchor.x,
        decayingAnchor.y,
        decayingAnchor.captureRadius * 1.55,
        PALETTE.coralSoft,
        0.52,
        3
      );
    }

    this.emit({ type: 'crash', reason });
  }

  private isOutOfSector(probe: Probe, viewport: ViewportMetrics): boolean {
    const cam = this.state.camera;
    const halfVisibleWorldW = (viewport.width / Math.max(0.01, viewport.viewScale)) * 0.62;
    const maxHoriz = Math.min(Math.max(340, halfVisibleWorldW), 420);

    if (Math.abs(probe.x - cam.x) > maxHoriz) {
      return true;
    }

    const launchAnchor = this.findAnchorById(probe.launchAnchorId);
    const floorRefY = launchAnchor ? Math.max(cam.y, launchAnchor.y) : cam.y;
    if (probe.y > floorRefY + 390) {
      return true;
    }

    let highestAnchorY = 0;
    const anchors = this.state.anchors;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].y < highestAnchorY) {
        highestAnchorY = anchors[i].y;
      }
    }

    if (probe.y < highestAnchorY - 420) {
      return true;
    }

    return false;
  }

  private recomputeAimVectorAndTrajectory(): void {
    const aim = this.state.aim;
    const pullX = aim.startScreen.x - aim.currentScreen.x;
    const pullY = aim.startScreen.y - aim.currentScreen.y;
    const pullDist = Math.hypot(pullX, pullY);

    if (pullDist < PHYSICS.MIN_PULL_PX) {
      aim.valid = false;
      aim.power = 0;
      aim.launchVelocity.x = 0;
      aim.launchVelocity.y = 0;
      aim.trajectory.length = 0;
      aim.lockedAnchorId = null;
      aim.hitsHazard = false;
      aim.deflectsOffShield = false;
      return;
    }

    const maxPull = Math.max(PHYSICS.MIN_PULL_PX + 1, this.currentMaxPullPx);
    const clamped = Math.min(pullDist, maxPull);
    const power = (clamped - PHYSICS.MIN_PULL_PX) / (maxPull - PHYSICS.MIN_PULL_PX);
    const activeAnchor = this.findAnchorById(this.state.probe.anchorId);
    const boost = activeAnchor ? activeAnchor.boostMultiplier : 1.0;
    const speed =
      (PHYSICS.MIN_LAUNCH_SPEED +
        (PHYSICS.MAX_LAUNCH_SPEED - PHYSICS.MIN_LAUNCH_SPEED) * Math.pow(power, 0.92)) *
      boost;

    const invDist = 1 / pullDist;
    aim.valid = true;
    aim.power = power;
    aim.launchVelocity.x = pullX * invDist * speed;
    aim.launchVelocity.y = pullY * invDist * speed;

    this.computeTrajectoryPreview();
  }

  private computeTrajectoryPreview(): void {
    const aim = this.state.aim;
    const probe = this.state.probe;
    const anchors = this.state.anchors;
    const repulsors = this.state.repulsors;

    const trajectory: TrajectoryPoint[] = aim.trajectory;
    trajectory.length = 0;
    aim.lockedAnchorId = null;
    aim.hitsHazard = false;
    aim.deflectsOffShield = false;

    const simPos: Vec2 = { x: probe.x, y: probe.y };
    const simVel: Vec2 = { x: aim.launchVelocity.x, y: aim.launchVelocity.y };
    const launchAnchorId = probe.anchorId;
    const dt = PHYSICS.FIXED_DT;
    const baseElapsed = this.state.elapsed;
    const anchorXOverrides = this.previewAnchorX;
    anchorXOverrides.length = anchors.length;
    let simTime = 0;
    let shieldBounces = 0;

    for (let step = 1; step <= PHYSICS.TRAJECTORY_STEPS; step++) {
      // Match live flight's advanceWorldBodies(dt) occurring before stepFlyingProbe(dt)
      const futureElapsed = baseElapsed + step * dt;
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        anchorXOverrides[i] =
          anchor.driftAmplitude > 0
            ? anchor.baseX +
              Math.sin(futureElapsed * anchor.driftSpeed + anchor.driftPhase) * anchor.driftAmplitude
            : anchor.x;
      }

      stepGravityFlight(
        simPos,
        simVel,
        anchors,
        launchAnchorId,
        simTime,
        dt,
        anchorXOverrides,
        repulsors
      );
      simTime += dt;

      // Predict hazard drone collision using each drone's future orbital angle & drifted anchor X
      let hitDrone = false;
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        const futureAnchorX = anchorXOverrides[i];
        const drones = anchor.drones;
        for (let j = 0; j < drones.length; j++) {
          const drone = drones[j];
          const futureAngle = drone.angle + drone.angularSpeed * simTime;
          const droneX = futureAnchorX + Math.cos(futureAngle) * drone.orbitRadius;
          const droneY = anchor.y + Math.sin(futureAngle) * drone.orbitRadius;
          const hitR = Math.max(2, probe.radius + drone.radius - TUNING.DRONE_HITBOX_FORGIVENESS);
          const dx = simPos.x - droneX;
          const dy = simPos.y - droneY;
          if (dx * dx + dy * dy <= hitR * hitR) {
            hitDrone = true;
            break;
          }
        }
        if (hitDrone) break;
      }

      if (hitDrone) {
        trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
        aim.hitsHazard = true;
        return;
      }

      // Predict repulsor core collision using exact same radius as live flight
      for (let i = 0; i < repulsors.length; i++) {
        const repulsor = repulsors[i];
        const hitR = Math.max(2, probe.radius + repulsor.coreRadius - 1.5);
        const dx = simPos.x - repulsor.x;
        const dy = simPos.y - repulsor.y;
        if (dx * dx + dy * dy <= hitR * hitR) {
          trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
          aim.hitsHazard = true;
          return;
        }
      }

      // Predict clean entry or rotating shield deflection on any non-ignored anchor
      let deflectedThisStep = false;
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        if (anchor.id === launchAnchorId && simTime < PHYSICS.LAUNCH_GRACE_TIME) {
          continue;
        }
        const dx = simPos.x - anchorXOverrides[i];
        const dy = simPos.y - anchor.y;
        if (dx * dx + dy * dy <= anchor.captureRadius * anchor.captureRadius) {
          if (anchor.shield) {
            const futureShieldAngle = anchor.shield.angle + anchor.shield.angularSpeed * simTime;
            if (
              tryDeflectOffShield(
                simPos,
                simVel,
                anchorXOverrides[i],
                anchor.y,
                anchor.captureRadius,
                futureShieldAngle,
                anchor.shield.arcSpan
              )
            ) {
              aim.deflectsOffShield = true;
              trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
              shieldBounces += 1;
              deflectedThisStep = true;
              if (shieldBounces > 2) {
                return;
              }
              break;
            }
          }

          trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
          aim.lockedAnchorId = anchor.id;
          return;
        }
      }

      if (!deflectedThisStep && step % PHYSICS.TRAJECTORY_SAMPLE_STRIDE === 0) {
        trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
      }
    }
  }

  private ensureAnchorsAhead(): void {
    if (this.state.mode === 'adventure') {
      return;
    }
    const targetMaxIndex = this.highestVisitedIndex + TUNING.AHEAD_ANCHOR_BUFFER;
    while (
      this.state.anchors.length > 0 &&
      this.state.anchors[this.state.anchors.length - 1].index < targetMaxIndex
    ) {
      this.spawnNextAnchor();
    }
  }

  private spawnAdventureAnchor(sector: SectorDefinition, index: number): void {
    const prev = this.state.anchors[this.state.anchors.length - 1];
    const isGoal = index === sector.anchorCount;
    const progress =
      sector.anchorCount > 1 ? clamp((index - 1) / (sector.anchorCount - 1), 0, 1) : 1;

    const captureRadius = isGoal
      ? 78
      : clamp(lerp(70, 56, progress) * sector.captureRadiusScale, 46, 78);
    const orbitRadius = isGoal ? 50 : clamp(captureRadius * 0.64, 33, 48);
    const coreRadius = isGoal ? 17 : lerp(15, 11.5, progress);
    const gravityStrength =
      lerp(
        TUNING.GRAVITY_STRENGTH_MIN,
        TUNING.GRAVITY_STRENGTH_MAX,
        isGoal ? 0.5 : progress
      ) * sector.gravityMultiplier;
    const gravityRange = captureRadius * 3.2 + 45;

    const fromBoost = prev.boostMultiplier > 1.05;
    let dy = fromBoost
      ? clamp(lerp(245, 295, progress) + this.levelRange(-10, 22), 235, 320)
      : clamp(lerp(205, 240, progress) + this.levelRange(-12, 20), 195, 260);

    const maxAbsX = isGoal ? 135 : 175;
    let sideSign: number;
    if (prev.baseX > 35) {
      sideSign = this.levelRng() < 0.82 ? -1 : 1;
    } else if (prev.baseX < -35) {
      sideSign = this.levelRng() < 0.82 ? 1 : -1;
    } else {
      sideSign = this.levelRng() < 0.5 ? -1 : 1;
    }

    const desiredDx = sideSign * this.levelRange(65, 165);
    let baseX = clamp(prev.baseX + desiredDx, -maxAbsX, maxAbsX);

    if (Math.abs(baseX - prev.baseX) < 65) {
      const flipSign = prev.baseX > 0 ? -1 : 1;
      baseX = clamp(prev.baseX + flipSign * this.levelRange(75, 145), -maxAbsX, maxAbsX);
    }

    const maxCenterDist = fromBoost ? 355 : 302;
    const minCenterDist = prev.captureRadius + captureRadius + 55;

    let dx = baseX - prev.baseX;
    let centerDist = Math.hypot(dx, dy);

    if (centerDist > maxCenterDist) {
      const maxAllowedDx = Math.sqrt(Math.max(0, maxCenterDist * maxCenterDist - dy * dy));
      dx = clamp(dx, -maxAllowedDx, maxAllowedDx);
      baseX = clamp(prev.baseX + dx, -maxAbsX, maxAbsX);
      centerDist = Math.hypot(baseX - prev.baseX, dy);
    }

    if (centerDist < minCenterDist) {
      const neededDy = Math.sqrt(Math.max(0, minCenterDist * minCenterDist - dx * dx));
      dy = clamp(Math.max(dy, neededDy), fromBoost ? 235 : 195, fromBoost ? 320 : 265);
    }

    const baseY = prev.baseY - dy;

    let driftAmplitude = 0;
    let driftSpeed = 0;
    let driftPhase = 0;
    if (!isGoal && sector.driftChance > 0 && index >= 2 && this.levelRng() < sector.driftChance) {
      const desiredAmp = this.levelRange(24, 52);
      const maxRoom = Math.min(170 - baseX, baseX + 170);
      if (maxRoom >= 20) {
        driftAmplitude = Math.min(desiredAmp, maxRoom);
      } else {
        baseX = clamp(baseX, -140, 140);
        driftAmplitude = Math.min(desiredAmp, 170 - Math.abs(baseX));
      }
      driftSpeed = this.levelRange(0.65, 1.1) * sector.driftSpeedScale;
      driftPhase = this.levelRng() * Math.PI * 2;
    }

    const initialX =
      driftAmplitude > 0
        ? baseX + Math.sin(this.state.elapsed * driftSpeed + driftPhase) * driftAmplitude
        : baseX;

    const hasDecay = !isGoal && sector.decayDuration > 0;
    const decayDuration = hasDecay ? sector.decayDuration : 0;

    const drones: HazardDrone[] = [];
    if (!isGoal && sector.droneChance > 0 && index >= 2 && this.levelRng() < sector.droneChance) {
      const twoDrones =
        sector.dualDroneChance > 0 && this.levelRng() < sector.dualDroneChance;
      const droneCount = twoDrones ? 2 : 1;
      const droneOrbitRadius = captureRadius + 16;
      const startAngle = this.levelRng() * Math.PI * 2;
      const angularSpeed =
        (this.levelRng() < 0.5 ? 1 : -1) *
        this.levelRange(1.1, 1.75) *
        sector.droneSpeedScale;

      for (let d = 0; d < droneCount; d++) {
        const angle = startAngle + (d === 1 ? Math.PI : 0);
        drones.push({
          id: this.allocateId(),
          orbitRadius: droneOrbitRadius,
          angle,
          angularSpeed,
          radius: TUNING.DRONE_RADIUS,
          x: initialX + Math.cos(angle) * droneOrbitRadius,
          y: baseY + Math.sin(angle) * droneOrbitRadius,
        });
      }
    }

    let shield: ShieldArc | null = null;
    if (
      !isGoal &&
      index >= 2 &&
      sector.shieldChance > 0 &&
      ((sector.id === 21 && index === 2) || this.levelRng() < sector.shieldChance)
    ) {
      shield = {
        angle: this.levelRng() * Math.PI * 2,
        angularSpeed:
          (this.levelRng() < 0.5 ? 1 : -1) *
          this.levelRange(0.75, 1.3) *
          sector.shieldSpeedScale,
        arcSpan: this.levelRange(Math.PI * 0.58, Math.PI * 0.88),
      };
    }

    let boostMultiplier = 1.0;
    if (
      !isGoal &&
      sector.boostChance > 0 &&
      ((sector.id === 31 && index === 1) ||
        (index >= 1 && index < sector.anchorCount && this.levelRng() < sector.boostChance))
    ) {
      boostMultiplier = Math.max(1.0, sector.boostMultiplier);
    }

    const nextAnchor: Anchor = {
      id: this.allocateId(),
      index,
      x: initialX,
      y: baseY,
      baseX,
      baseY,
      coreRadius,
      orbitRadius,
      captureRadius,
      gravityStrength,
      gravityRange,
      driftAmplitude,
      driftSpeed,
      driftPhase,
      hasDecay,
      decayDuration,
      decayRemaining: decayDuration,
      decayActive: false,
      visited: false,
      isGoal,
      boostMultiplier,
      shield,
      capturePulse: 0,
      deflectPulse: 0,
      drones,
    };

    this.state.anchors.push(nextAnchor);
    this.spawnShardsBetween(prev, nextAnchor);
    if (
      sector.repulsorChance > 0 &&
      ((sector.id === 11 && index === 1) || this.levelRng() < sector.repulsorChance)
    ) {
      this.spawnRepulsorBetween(prev, nextAnchor, sector.repulsorStrengthScale);
    }
  }

  private spawnNextAnchor(): void {
    const prev = this.state.anchors[this.state.anchors.length - 1];
    const index = prev.index + 1;
    const difficulty = clamp((index - 1) / 28, 0, 1);

    const coreRadius = lerp(15, 11, difficulty);
    const orbitRadius = lerp(46, 35, difficulty);
    const captureRadius = lerp(72, 52, difficulty);
    const gravityStrength = lerp(
      TUNING.GRAVITY_STRENGTH_MIN,
      TUNING.GRAVITY_STRENGTH_MAX,
      difficulty
    );
    const gravityRange = captureRadius * 3.2 + 45;

    const fromBoost = prev.boostMultiplier > 1.05;
    let dy = fromBoost
      ? clamp(lerp(245, 295, difficulty) + this.levelRange(-10, 22), 235, 320)
      : clamp(lerp(205, 245, difficulty) + this.levelRange(-12, 22), 195, 265);

    // Choose horizontal side to encourage fun angled slingshot arcs
    let sideSign: number;
    if (prev.baseX > 35) {
      sideSign = this.levelRng() < 0.82 ? -1 : 1;
    } else if (prev.baseX < -35) {
      sideSign = this.levelRng() < 0.82 ? 1 : -1;
    } else {
      sideSign = this.levelRng() < 0.5 ? -1 : 1;
    }

    const desiredDx = sideSign * this.levelRange(65, 170);
    let baseX = clamp(prev.baseX + desiredDx, -175, 175);

    // Ensure minimum horizontal angle so anchors don't stack into a dead-straight column
    if (Math.abs(baseX - prev.baseX) < 65) {
      const flipSign = prev.baseX > 0 ? -1 : 1;
      baseX = clamp(prev.baseX + flipSign * this.levelRange(75, 145), -175, 175);
    }

    // Guarantee reachable center-to-center distance and non-overlapping capture rings
    const maxCenterDist = fromBoost ? 355 : 302;
    const minCenterDist = prev.captureRadius + captureRadius + 55;

    let dx = baseX - prev.baseX;
    let centerDist = Math.hypot(dx, dy);

    if (centerDist > maxCenterDist) {
      const maxAllowedDx = Math.sqrt(Math.max(0, maxCenterDist * maxCenterDist - dy * dy));
      dx = clamp(dx, -maxAllowedDx, maxAllowedDx);
      baseX = clamp(prev.baseX + dx, -175, 175);
      centerDist = Math.hypot(baseX - prev.baseX, dy);
    }

    if (centerDist < minCenterDist) {
      const neededDy = Math.sqrt(Math.max(0, minCenterDist * minCenterDist - dx * dx));
      dy = clamp(Math.max(dy, neededDy), fromBoost ? 235 : 195, fromBoost ? 320 : 265);
    }

    const baseY = prev.baseY - dy;

    // Gentle horizontal drift starting from index 7, keeping outer drones inside ±260 sector rails
    let driftAmplitude = 0;
    let driftSpeed = 0;
    let driftPhase = 0;
    if (index >= 7 && this.levelRng() < 0.45) {
      const desiredAmp = this.levelRange(24, 52);
      const maxRoom = Math.min(170 - baseX, baseX + 170);
      if (maxRoom >= 20) {
        driftAmplitude = Math.min(desiredAmp, maxRoom);
        driftSpeed = this.levelRange(0.65, 1.15);
        driftPhase = this.levelRng() * Math.PI * 2;
      } else {
        baseX = clamp(baseX, -140, 140);
        driftAmplitude = Math.min(desiredAmp, 170 - Math.abs(baseX));
        driftSpeed = this.levelRange(0.65, 1.15);
        driftPhase = this.levelRng() * Math.PI * 2;
      }
    }

    const initialX =
      driftAmplitude > 0
        ? baseX + Math.sin(this.state.elapsed * driftSpeed + driftPhase) * driftAmplitude
        : baseX;

    // Decay timer tightens smoothly from 6.8s down to a fair 3.8s floor
    const decayDuration = lerp(6.8, 3.8, clamp((index - 1) / 30, 0, 1));

    // Orbiting hazard drones appear reliably from anchor 5 onward (aligned with score 5+)
    const drones: HazardDrone[] = [];
    const allowDrones = index >= 5;
    const droneChance = index === 5 ? 1 : lerp(0.62, 0.86, difficulty);
    if (allowDrones && this.levelRng() < droneChance) {
      const twoDrones = index >= 16 && this.levelRng() < 0.35;
      const droneCount = twoDrones ? 2 : 1;
      const droneOrbitRadius = captureRadius + 16;
      const startAngle = this.levelRng() * Math.PI * 2;
      const angularSpeed = (this.levelRng() < 0.5 ? 1 : -1) * this.levelRange(1.1, 1.85);

      for (let d = 0; d < droneCount; d++) {
        const angle = startAngle + (d === 1 ? Math.PI : 0);
        drones.push({
          id: this.allocateId(),
          orbitRadius: droneOrbitRadius,
          angle,
          angularSpeed,
          radius: TUNING.DRONE_RADIUS,
          x: initialX + Math.cos(angle) * droneOrbitRadius,
          y: baseY + Math.sin(angle) * droneOrbitRadius,
        });
      }
    }

    let shield: ShieldArc | null = null;
    if (index >= 18 && this.levelRng() < 0.25) {
      shield = {
        angle: this.levelRng() * Math.PI * 2,
        angularSpeed: (this.levelRng() < 0.5 ? 1 : -1) * this.levelRange(0.78, 1.32),
        arcSpan: this.levelRange(Math.PI * 0.58, Math.PI * 0.86),
      };
    }

    let boostMultiplier = 1.0;
    if (index >= 12 && this.levelRng() < 0.22) {
      boostMultiplier = 1.32;
    }

    const nextAnchor: Anchor = {
      id: this.allocateId(),
      index,
      x: initialX,
      y: baseY,
      baseX,
      baseY,
      coreRadius,
      orbitRadius,
      captureRadius,
      gravityStrength,
      gravityRange,
      driftAmplitude,
      driftSpeed,
      driftPhase,
      hasDecay: true,
      decayDuration,
      decayRemaining: decayDuration,
      decayActive: false,
      visited: false,
      isGoal: false,
      boostMultiplier,
      shield,
      capturePulse: 0,
      deflectPulse: 0,
      drones,
    };

    this.state.anchors.push(nextAnchor);
    this.spawnShardsBetween(prev, nextAnchor);
    if (index >= 14 && this.levelRng() < 0.28) {
      this.spawnRepulsorBetween(prev, nextAnchor, 1.0);
    }
  }

  private spawnShardsBetween(prev: Anchor, next: Anchor): void {
    const dx = next.baseX - prev.baseX;
    const dy = next.baseY - prev.baseY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;

    // Perpendicular unit vector for a natural curved slingshot arc
    const perpX = -dy / dist;
    const perpY = dx / dist;

    // Bias curve slightly toward the arena center so shards stay comfortably playable
    const midX = (prev.baseX + next.baseX) * 0.5;
    const midY = (prev.baseY + next.baseY) * 0.5;
    const centerBias = midX > 20 ? -1 : midX < -20 ? 1 : this.levelRng() < 0.5 ? 1 : -1;
    const curveSign = perpX * centerBias >= 0 ? 1 : -1;
    const arcOffset = curveSign * this.levelRange(24, 46);

    const ctrlX = clamp(midX + perpX * arcOffset, -205, 205);
    const ctrlY = midY + perpY * arcOffset;

    const shardCount = this.levelRng() < 0.48 ? 2 : 1;
    const tValues = shardCount === 2 ? [0.39, 0.61] : [0.5];

    for (let i = 0; i < tValues.length; i++) {
      const u = tValues[i];
      const inv = 1 - u;
      const sx = clamp(
        inv * inv * prev.baseX + 2 * inv * u * ctrlX + u * u * next.baseX,
        -215,
        215
      );
      const sy = inv * inv * prev.baseY + 2 * inv * u * ctrlY + u * u * next.baseY;

      // Ensure shard does not sit inside either anchor's capture ring
      const dPrev = Math.hypot(sx - prev.baseX, sy - prev.baseY);
      const dNext = Math.hypot(sx - next.baseX, sy - next.baseY);
      if (dPrev < prev.captureRadius + 20 || dNext < next.captureRadius + 20) {
        continue;
      }

      const shard: EnergyShard = {
        id: this.allocateId(),
        x: sx,
        y: sy,
        radius: TUNING.SHARD_RADIUS,
        collected: false,
        pulsePhase: this.levelRng() * Math.PI * 2,
        value: 1,
      };
      this.state.shards.push(shard);
    }
  }

  private spawnRepulsorBetween(prev: Anchor, next: Anchor, strengthScale: number): void {
    const dx = next.baseX - prev.baseX;
    const dy = next.baseY - prev.baseY;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;

    const coreRadius = 12;
    const range = 135;
    const strength = 1_550_000 * strengthScale;

    const perpX = -dy / dist;
    const perpY = dx / dist;
    const midX = (prev.baseX + next.baseX) * 0.5;
    const midY = (prev.baseY + next.baseY) * 0.5;
    const offsetMag = this.levelRange(78, 112);

    // Prefer the side opposite any shards placed in this corridor, or closer to x = 0
    const minY = Math.min(prev.baseY, next.baseY);
    const maxY = Math.max(prev.baseY, next.baseY);
    let shardProjSum = 0;
    let shardProjCount = 0;
    const shards = this.state.shards;
    for (let i = 0; i < shards.length; i++) {
      const s = shards[i];
      if (s.y >= minY && s.y <= maxY) {
        shardProjSum += (s.x - midX) * perpX + (s.y - midY) * perpY;
        shardProjCount += 1;
      }
    }

    let preferredSign: 1 | -1;
    if (shardProjCount > 0 && Math.abs(shardProjSum) > 1) {
      preferredSign = shardProjSum > 0 ? -1 : 1;
    } else {
      const plusX = clamp(midX + perpX * offsetMag, -205, 205);
      const minusX = clamp(midX - perpX * offsetMag, -205, 205);
      preferredSign = Math.abs(plusX) <= Math.abs(minusX) ? 1 : -1;
    }

    const candidateSigns: readonly (1 | -1)[] = [
      preferredSign,
      preferredSign === 1 ? -1 : 1,
    ];

    const minPrevClearance = prev.captureRadius + coreRadius + 42;
    const minNextClearance = next.captureRadius + coreRadius + 42;

    for (let c = 0; c < candidateSigns.length; c++) {
      const sign = candidateSigns[c];
      const rx = clamp(midX + perpX * offsetMag * sign, -205, 205);
      const ry = midY + perpY * offsetMag * sign;

      // Account for worst-case horizontal drift so moving anchors & their drones never sweep into repulsors
      const prevMinDx = Math.max(0, Math.abs(rx - prev.baseX) - prev.driftAmplitude);
      const nextMinDx = Math.max(0, Math.abs(rx - next.baseX) - next.driftAmplitude);
      if (Math.hypot(prevMinDx, ry - prev.baseY) < minPrevClearance) {
        continue;
      }
      if (Math.hypot(nextMinDx, ry - next.baseY) < minNextClearance) {
        continue;
      }

      let blocked = false;
      for (let i = 0; i < shards.length; i++) {
        const shard = shards[i];
        const minShardDist = coreRadius + shard.radius + 16;
        if (Math.hypot(rx - shard.x, ry - shard.y) < minShardDist) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const repulsors = this.state.repulsors;
      for (let i = 0; i < repulsors.length; i++) {
        const existing = repulsors[i];
        const minRepDist = coreRadius + existing.coreRadius + 30;
        if (Math.hypot(rx - existing.x, ry - existing.y) < minRepDist) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      const repulsor: RepulsorNode = {
        id: this.allocateId(),
        x: rx,
        y: ry,
        coreRadius,
        strength,
        range,
        pulsePhase: this.levelRng() * Math.PI * 2,
      };
      this.state.repulsors.push(repulsor);
      return;
    }
  }

  private pruneBehindCamera(): void {
    if (this.state.mode === 'adventure') {
      return;
    }
    const cutoffY = this.state.camera.y + TUNING.PRUNE_BELOW_CAMERA;
    const activeAnchorId = this.state.probe.anchorId;

    const anchors = this.state.anchors;
    let writeAnchor = 0;
    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      if (anchor.id === activeAnchorId || anchor.y <= cutoffY) {
        anchors[writeAnchor++] = anchor;
      }
    }
    anchors.length = writeAnchor;

    const repulsors = this.state.repulsors;
    let writeRepulsor = 0;
    for (let i = 0; i < repulsors.length; i++) {
      const repulsor = repulsors[i];
      if (repulsor.y <= cutoffY) {
        repulsors[writeRepulsor++] = repulsor;
      }
    }
    repulsors.length = writeRepulsor;

    const shards = this.state.shards;
    let writeShard = 0;
    for (let i = 0; i < shards.length; i++) {
      const shard = shards[i];
      if (!shard.collected && shard.y <= cutoffY) {
        shards[writeShard++] = shard;
      }
    }
    shards.length = writeShard;
  }

  private updateCamera(dt: number): void {
    const cam = this.state.camera;
    const probe = this.state.probe;

    if (probe.mode === 'orbiting') {
      const activeAnchor = this.findAnchorById(probe.anchorId);
      if (activeAnchor) {
        cam.targetY = activeAnchor.y;
      }
      cam.targetX = clamp(probe.x * 0.16, -45, 45);
    } else if (probe.mode === 'flying') {
      const launchAnchor = this.findAnchorById(probe.launchAnchorId);
      const maxTargetY = launchAnchor ? launchAnchor.y : cam.targetY;
      cam.targetY = Math.min(maxTargetY, probe.y + 40);
      cam.targetX = clamp(probe.x * 0.16, -45, 45);
    }

    const alpha = 1 - Math.exp(-TUNING.CAMERA_LERP_RATE * dt);
    cam.x += (cam.targetX - cam.x) * alpha;
    cam.y += (cam.targetY - cam.y) * alpha;

    if (cam.shakeMagnitude > 0.05) {
      cam.shakeMagnitude = Math.max(0, cam.shakeMagnitude * Math.exp(-12 * dt) - dt * 1.5);
      const angle = Math.random() * Math.PI * 2;
      cam.shakeOffsetX = Math.cos(angle) * cam.shakeMagnitude;
      cam.shakeOffsetY = Math.sin(angle) * cam.shakeMagnitude;
    } else {
      cam.shakeMagnitude = 0;
      cam.shakeOffsetX = 0;
      cam.shakeOffsetY = 0;
    }
  }

  private updateAnchorPulsesAndShards(dt: number): void {
    const anchors = this.state.anchors;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].capturePulse > 0) {
        anchors[i].capturePulse = Math.max(0, anchors[i].capturePulse - dt * 2.2);
      }
      if (anchors[i].deflectPulse > 0) {
        anchors[i].deflectPulse = Math.max(0, anchors[i].deflectPulse - dt * 2.8);
      }
    }
  }

  private ageTrail(dt: number): void {
    const trail = this.state.probe.trail;
    let write = 0;
    for (let i = 0; i < trail.length; i++) {
      const pt = trail[i];
      pt.age += dt;
      if (pt.age <= TUNING.TRAIL_MAX_AGE) {
        trail[write++] = pt;
      }
    }
    trail.length = write;
  }

  private recordTrailPoint(x: number, y: number): void {
    const trail = this.state.probe.trail;
    if (trail.length > 0) {
      const last = trail[trail.length - 1];
      const dx = x - last.x;
      const dy = y - last.y;
      if (dx * dx + dy * dy < TUNING.TRAIL_MIN_STEP_SQ) {
        return;
      }
    }

    trail.push({ x, y, age: 0 });
    if (trail.length > TUNING.TRAIL_MAX_POINTS) {
      trail.splice(0, trail.length - TUNING.TRAIL_MAX_POINTS);
    }
  }

  private updateParticles(dt: number): void {
    const particles = this.state.particles;
    const drag = Math.exp(-3.2 * dt);
    let write = 0;

    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      p.life += dt;
      if (p.life >= p.maxLife) continue;

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.alpha = Math.max(0, 1 - p.life / p.maxLife);
      particles[write++] = p;
    }
    particles.length = write;
  }

  private updateShockwaves(dt: number): void {
    const shockwaves = this.state.shockwaves;
    let write = 0;

    for (let i = 0; i < shockwaves.length; i++) {
      const s = shockwaves[i];
      s.life += dt;
      if (s.life >= s.maxLife) continue;

      const t = clamp(s.life / s.maxLife, 0, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      s.radius = s.maxRadius * eased;
      shockwaves[write++] = s;
    }
    shockwaves.length = write;
  }

  private updateFloatingTexts(dt: number): void {
    const texts = this.state.floatingTexts;
    const drag = Math.exp(-2.2 * dt);
    let write = 0;

    for (let i = 0; i < texts.length; i++) {
      const ft = texts[i];
      ft.life += dt;
      if (ft.life >= ft.maxLife) continue;

      ft.y += ft.vy * dt;
      ft.vy *= drag;
      texts[write++] = ft;
    }
    texts.length = write;
  }

  private spawnLaunchParticles(
    x: number,
    y: number,
    vx: number,
    vy: number,
    power: number,
    boosted = false
  ): void {
    const speed = Math.hypot(vx, vy);
    if (speed < 1e-4) return;
    const backAngle = Math.atan2(-vy, -vx);
    const count = Math.round((boosted ? 12 : 7) + power * (boosted ? 9 : 6));

    for (let i = 0; i < count; i++) {
      const spread = randomRange(boosted ? -0.62 : -0.55, boosted ? 0.62 : 0.55);
      const angle = backAngle + spread;
      const pSpeed = randomRange(55, boosted ? 185 : 145) * (0.6 + power * 0.65);
      const maxLife = randomRange(0.22, boosted ? 0.48 : 0.42);
      const color = boosted
        ? i % 3 === 0
          ? PALETTE.gold
          : i % 3 === 1
            ? PALETTE.cyan
            : PALETTE.goldSoft
        : i % 3 === 0
          ? PALETTE.white
          : PALETTE.cyanSoft;
      const particle: Particle = {
        x,
        y,
        vx: Math.cos(angle) * pSpeed,
        vy: Math.sin(angle) * pSpeed,
        size: randomRange(boosted ? 2.1 : 1.8, boosted ? 3.9 : 3.4),
        color,
        alpha: 1,
        life: 0,
        maxLife,
      };
      this.state.particles.push(particle);
    }
  }

  private spawnBurstParticles(
    x: number,
    y: number,
    count: number,
    primaryColor: string,
    secondaryColor: string,
    minSpeed: number,
    maxSpeed: number
  ): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + randomRange(-0.22, 0.22);
      const speed = randomRange(minSpeed, maxSpeed);
      const maxLife = randomRange(0.32, 0.68);
      const particle: Particle = {
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: randomRange(2, 4.2),
        color: i % 3 === 0 ? secondaryColor : primaryColor,
        alpha: 1,
        life: 0,
        maxLife,
      };
      this.state.particles.push(particle);
    }
  }

  private spawnShockwave(
    x: number,
    y: number,
    maxRadius: number,
    color: string,
    maxLife: number,
    lineWidth: number
  ): void {
    const wave: Shockwave = {
      x,
      y,
      radius: 4,
      maxRadius,
      color,
      life: 0,
      maxLife,
      lineWidth,
    };
    this.state.shockwaves.push(wave);
  }

  private spawnFloatingText(
    x: number,
    y: number,
    text: string,
    color: string,
    scale: number
  ): void {
    const ft: FloatingText = {
      x,
      y,
      vy: -56,
      text,
      color,
      life: 0,
      maxLife: 0.9,
      scale,
    };
    this.state.floatingTexts.push(ft);
  }

  private levelRange(min: number, max: number): number {
    return min + this.levelRng() * (max - min);
  }

  private addScore(points: number): void {
    if (points <= 0) return;
    this.state.score += points;
    if (this.state.score > this.state.bestScore) {
      this.state.bestScore = this.state.score;
      this.state.isNewBest = true;

      if (this.state.mode === 'adventure') {
        const sectorId = this.state.adventureSectorId;
        const existing = this.adventureProgress[sectorId];
        this.adventureProgress[sectorId] = {
          cleared: existing?.cleared ?? false,
          stars: existing?.stars ?? 0,
          bestScore: Math.max(existing?.bestScore ?? 0, this.state.bestScore),
        };
        saveAdventureProgress(this.adventureProgress);
      } else {
        this.endlessBestScore = this.state.bestScore;
        saveBestScore(BEST_SCORE_STORAGE_KEY, this.state.bestScore);
      }
    }
  }

  private addCameraShake(magnitude: number): void {
    this.state.camera.shakeMagnitude = Math.max(this.state.camera.shakeMagnitude, magnitude);
  }

  private clearAim(): void {
    const aim = this.state.aim;
    aim.active = false;
    aim.power = 0;
    aim.valid = false;
    aim.launchVelocity.x = 0;
    aim.launchVelocity.y = 0;
    aim.trajectory.length = 0;
    aim.lockedAnchorId = null;
    aim.hitsHazard = false;
    aim.deflectsOffShield = false;
  }

  private computeMaxPullPx(viewport: ViewportMetrics): number {
    const minDim = Math.min(viewport.width, viewport.height);
    return Math.min(PHYSICS.MAX_PULL_PX, Math.max(90, minDim * 0.34));
  }

  private findAnchorById(id: number | null): Anchor | null {
    if (id === null) return null;
    const anchors = this.state.anchors;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i].id === id) return anchors[i];
    }
    return null;
  }

  private allocateId(): number {
    return this.nextEntityId++;
  }

  private emit(event: GameEvent): void {
    if (this.onEvent) {
      this.onEvent(event);
    }
  }
}
