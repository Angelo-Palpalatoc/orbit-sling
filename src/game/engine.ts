import {
  PALETTE,
  PHYSICS,
  type AimState,
  type Anchor,
  type CameraState,
  type EnergyShard,
  type FloatingText,
  type GameEvent,
  type GameOverReason,
  type GameState,
  type HazardDrone,
  type Particle,
  type Probe,
  type Shockwave,
  type TrajectoryPoint,
  type Vec2,
  type ViewportMetrics,
} from './types';

const BEST_SCORE_STORAGE_KEY = 'orbit-sling-best-v1';

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

function loadBestScore(): number {
  try {
    if (typeof localStorage === 'undefined') return 0;
    const raw = localStorage.getItem(BEST_SCORE_STORAGE_KEY);
    if (!raw) return 0;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function saveBestScore(score: number): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(BEST_SCORE_STORAGE_KEY, String(Math.max(0, Math.floor(score))));
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
  anchorXOverrides?: readonly number[]
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

  constructor(onEvent?: (event: GameEvent) => void) {
    this.onEvent = onEvent;
    this.state = this.createBlankState(loadBestScore());
    this.reset();
  }

  private createBlankState(bestScore: number): GameState {
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
      score: 0,
      bestScore,
      isNewBest: false,
      combo: 0,
      maxCombo: 0,
      anchorsCaptured: 0,
      gameOverReason: null,
      gameOverElapsed: 0,
      elapsed: 0,
      hitStopRemaining: 0,
      probe: startProbe,
      anchors: [],
      shards: [],
      particles: [],
      shockwaves: [],
      floatingTexts: [],
      aim: createEmptyAim(),
      camera: createInitialCamera(),
    };
  }

  reset(): void {
    const persistedBest = Math.max(this.state.bestScore, loadBestScore());

    this.nextEntityId = 1;
    this.highestVisitedIndex = 0;
    this.physicsAccumulator = 0;
    this.decayWarnCooldown = 0;
    this.currentMaxPullPx = PHYSICS.MAX_PULL_PX;

    this.state.status = 'ready';
    this.state.score = 0;
    this.state.bestScore = persistedBest;
    this.state.isNewBest = false;
    this.state.combo = 0;
    this.state.maxCombo = 0;
    this.state.anchorsCaptured = 0;
    this.state.gameOverReason = null;
    this.state.gameOverElapsed = 0;
    this.state.elapsed = 0;
    this.state.hitStopRemaining = 0;

    this.state.anchors.length = 0;
    this.state.shards.length = 0;
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
      capturePulse: 0,
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

    this.ensureAnchorsAhead();
  }

  canQuickRestart(): boolean {
    return (
      this.state.status === 'gameover' &&
      this.state.gameOverElapsed >= TUNING.QUICK_RESTART_DELAY
    );
  }

  beginAim(screenX: number, screenY: number, viewport: ViewportMetrics): void {
    if (this.state.status === 'gameover' || this.state.probe.mode !== 'orbiting') {
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
  }

  updateAim(screenX: number, screenY: number, viewport: ViewportMetrics): void {
    const aim = this.state.aim;
    if (!aim.active || this.state.status === 'gameover' || this.state.probe.mode !== 'orbiting') {
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

    this.spawnLaunchParticles(probe.x, probe.y, launchVx, launchVy, power);
    this.emit({ type: 'launch', power });
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
      dt
    );

    probe.x = pos.x;
    probe.y = pos.y;
    probe.vx = vel.x;
    probe.vy = vel.y;
    probe.flightTime += dt;

    // 1. Hazard drone collision check first
    if (this.checkDroneCollision(probe)) {
      this.triggerCrash('DRONE_COLLISION', null);
      return true;
    }

    // 2. Energy shard collection
    this.checkShardCollection(probe);

    // 3. Anchor capture check
    const capturedAnchor = this.findCapturedAnchor(probe);
    if (capturedAnchor) {
      this.handleAnchorCapture(capturedAnchor);
      return true;
    }

    // 4. Out-of-sector bounds check
    if (this.isOutOfSector(probe, viewport)) {
      this.triggerCrash('OUT_OF_SECTOR', null);
      return true;
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

    if (!anchor.visited) {
      const skipped = Math.max(0, anchor.index - this.highestVisitedIndex - 1);
      anchor.visited = true;
      if (anchor.index > this.highestVisitedIndex) {
        this.highestVisitedIndex = anchor.index;
      }

      this.state.anchorsCaptured += 1;
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

  private triggerCrash(reason: GameOverReason, decayingAnchor: Anchor | null): void {
    if (this.state.status === 'gameover') return;

    this.state.status = 'gameover';
    this.state.probe.mode = 'crashed';
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
      return;
    }

    const maxPull = Math.max(PHYSICS.MIN_PULL_PX + 1, this.currentMaxPullPx);
    const clamped = Math.min(pullDist, maxPull);
    const power = (clamped - PHYSICS.MIN_PULL_PX) / (maxPull - PHYSICS.MIN_PULL_PX);
    const speed =
      PHYSICS.MIN_LAUNCH_SPEED +
      (PHYSICS.MAX_LAUNCH_SPEED - PHYSICS.MIN_LAUNCH_SPEED) * Math.pow(power, 0.92);

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

    const trajectory: TrajectoryPoint[] = aim.trajectory;
    trajectory.length = 0;
    aim.lockedAnchorId = null;
    aim.hitsHazard = false;

    const simPos: Vec2 = { x: probe.x, y: probe.y };
    const simVel: Vec2 = { x: aim.launchVelocity.x, y: aim.launchVelocity.y };
    const launchAnchorId = probe.anchorId;
    const dt = PHYSICS.FIXED_DT;
    const baseElapsed = this.state.elapsed;
    const anchorXOverrides = this.previewAnchorX;
    anchorXOverrides.length = anchors.length;
    let simTime = 0;

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

      stepGravityFlight(simPos, simVel, anchors, launchAnchorId, simTime, dt, anchorXOverrides);
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

      // Predict clean entry into any non-ignored anchor's capture zone at its drifted X
      for (let i = 0; i < anchors.length; i++) {
        const anchor = anchors[i];
        if (anchor.id === launchAnchorId && simTime < PHYSICS.LAUNCH_GRACE_TIME) {
          continue;
        }
        const dx = simPos.x - anchorXOverrides[i];
        const dy = simPos.y - anchor.y;
        if (dx * dx + dy * dy <= anchor.captureRadius * anchor.captureRadius) {
          trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
          aim.lockedAnchorId = anchor.id;
          return;
        }
      }

      if (step % PHYSICS.TRAJECTORY_SAMPLE_STRIDE === 0) {
        trajectory.push({ x: simPos.x, y: simPos.y, t: simTime });
      }
    }
  }

  private ensureAnchorsAhead(): void {
    const targetMaxIndex = this.highestVisitedIndex + TUNING.AHEAD_ANCHOR_BUFFER;
    while (
      this.state.anchors.length > 0 &&
      this.state.anchors[this.state.anchors.length - 1].index < targetMaxIndex
    ) {
      this.spawnNextAnchor();
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

    let dy = clamp(lerp(205, 245, difficulty) + randomRange(-12, 22), 195, 265);

    // Choose horizontal side to encourage fun angled slingshot arcs
    let sideSign: number;
    if (prev.baseX > 35) {
      sideSign = Math.random() < 0.82 ? -1 : 1;
    } else if (prev.baseX < -35) {
      sideSign = Math.random() < 0.82 ? 1 : -1;
    } else {
      sideSign = Math.random() < 0.5 ? -1 : 1;
    }

    const desiredDx = sideSign * randomRange(65, 170);
    let baseX = clamp(prev.baseX + desiredDx, -175, 175);

    // Ensure minimum horizontal angle so anchors don't stack into a dead-straight column
    if (Math.abs(baseX - prev.baseX) < 65) {
      const flipSign = prev.baseX > 0 ? -1 : 1;
      baseX = clamp(prev.baseX + flipSign * randomRange(75, 145), -175, 175);
    }

    // Guarantee center-to-center distance <= 305 and non-overlapping capture rings
    const maxCenterDist = 302;
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
      dy = clamp(Math.max(dy, neededDy), 195, 265);
    }

    const baseY = prev.baseY - dy;

    // Gentle horizontal drift starting from index 7, keeping outer drones inside ±260 sector rails
    let driftAmplitude = 0;
    let driftSpeed = 0;
    let driftPhase = 0;
    if (index >= 7 && Math.random() < 0.45) {
      const desiredAmp = randomRange(24, 52);
      const maxRoom = Math.min(170 - baseX, baseX + 170);
      if (maxRoom >= 20) {
        driftAmplitude = Math.min(desiredAmp, maxRoom);
        driftSpeed = randomRange(0.65, 1.15);
        driftPhase = Math.random() * Math.PI * 2;
      } else {
        baseX = clamp(baseX, -140, 140);
        driftAmplitude = Math.min(desiredAmp, 170 - Math.abs(baseX));
        driftSpeed = randomRange(0.65, 1.15);
        driftPhase = Math.random() * Math.PI * 2;
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
    if (allowDrones && Math.random() < droneChance) {
      const twoDrones = index >= 16 && Math.random() < 0.35;
      const droneCount = twoDrones ? 2 : 1;
      const droneOrbitRadius = captureRadius + 16;
      const startAngle = Math.random() * Math.PI * 2;
      const angularSpeed = (Math.random() < 0.5 ? 1 : -1) * randomRange(1.1, 1.85);

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
      capturePulse: 0,
      drones,
    };

    this.state.anchors.push(nextAnchor);
    this.spawnShardsBetween(prev, nextAnchor);
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
    const centerBias = midX > 20 ? -1 : midX < -20 ? 1 : Math.random() < 0.5 ? 1 : -1;
    const curveSign = perpX * centerBias >= 0 ? 1 : -1;
    const arcOffset = curveSign * randomRange(24, 46);

    const ctrlX = clamp(midX + perpX * arcOffset, -205, 205);
    const ctrlY = midY + perpY * arcOffset;

    const shardCount = Math.random() < 0.48 ? 2 : 1;
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
        pulsePhase: Math.random() * Math.PI * 2,
        value: 1,
      };
      this.state.shards.push(shard);
    }
  }

  private pruneBehindCamera(): void {
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
    power: number
  ): void {
    const speed = Math.hypot(vx, vy);
    if (speed < 1e-4) return;
    const backAngle = Math.atan2(-vy, -vx);
    const count = Math.round(7 + power * 6);

    for (let i = 0; i < count; i++) {
      const spread = randomRange(-0.55, 0.55);
      const angle = backAngle + spread;
      const pSpeed = randomRange(55, 145) * (0.6 + power * 0.65);
      const maxLife = randomRange(0.22, 0.42);
      const particle: Particle = {
        x,
        y,
        vx: Math.cos(angle) * pSpeed,
        vy: Math.sin(angle) * pSpeed,
        size: randomRange(1.8, 3.4),
        color: i % 3 === 0 ? PALETTE.white : PALETTE.cyanSoft,
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

  private addScore(points: number): void {
    if (points <= 0) return;
    this.state.score += points;
    if (this.state.score > this.state.bestScore) {
      this.state.bestScore = this.state.score;
      this.state.isNewBest = true;
      saveBestScore(this.state.bestScore);
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
