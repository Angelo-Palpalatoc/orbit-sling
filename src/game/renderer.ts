import {
  Anchor,
  CameraState,
  EnergyShard,
  FloatingText,
  GameState,
  PALETTE,
  PHYSICS,
  Particle,
  Probe,
  Shockwave,
  Star,
  ViewportMetrics,
  computeViewportMetrics,
  worldToScreen,
} from './types';

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function createSeededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStarfield(count: number): Star[] {
  const rand = createSeededRandom(0x0b1751a9);
  const stars: Star[] = [];

  const farTints = ['#CBD5E1', '#94A3B8', '#E2E8F0'];
  const midTints = ['#E2E8F0', '#F8FAFC', '#BAE6FD', '#CBD5E1'];
  const nearTints = ['#F8FAFC', '#E0F2FE', '#7DD3FC', '#FDE68A'];

  for (let i = 0; i < count; i++) {
    const roll = i / count;
    let depth: number;
    let size: number;
    let alpha: number;
    let tint: string;

    if (roll < 0.46) {
      // Far layer
      depth = 0.12 + rand() * 0.05;
      size = 0.65 + rand() * 0.55;
      alpha = 0.2 + rand() * 0.22;
      tint = farTints[Math.floor(rand() * farTints.length)];
    } else if (roll < 0.8) {
      // Mid layer
      depth = 0.22 + rand() * 0.08;
      size = 1.0 + rand() * 0.7;
      alpha = 0.34 + rand() * 0.26;
      tint = midTints[Math.floor(rand() * midTints.length)];
    } else {
      // Near layer
      depth = 0.35 + rand() * 0.1;
      size = 1.35 + rand() * 0.85;
      alpha = 0.48 + rand() * 0.32;
      tint = nearTints[Math.floor(rand() * nearTints.length)];
    }

    stars.push({
      x: rand(),
      y: rand(),
      size,
      alpha,
      depth,
      twinklePhase: rand() * Math.PI * 2,
      tint,
    });
  }

  return stars;
}

function decayColor(fraction: number): { r: number; g: number; b: number } {
  // Cyan (#38BDF8: 56, 189, 248) -> Gold (#F5B841: 245, 184, 65) -> Coral (#F43F5E: 244, 63, 94)
  if (fraction > 0.55) {
    return { r: 56, g: 189, b: 248 };
  }
  if (fraction > 0.28) {
    const t = clamp((0.55 - fraction) / (0.55 - 0.28), 0, 1);
    const blend = clamp(t * 1.4, 0, 1);
    return {
      r: Math.round(lerp(56, 245, blend)),
      g: Math.round(lerp(189, 184, blend)),
      b: Math.round(lerp(248, 65, blend)),
    };
  }
  const t = clamp((0.28 - fraction) / 0.14, 0, 1);
  return {
    r: Math.round(lerp(245, 244, t)),
    g: Math.round(lerp(184, 63, t)),
    b: Math.round(lerp(65, 94, t)),
  };
}

export class GameRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly stars: Star[];
  private viewport: ViewportMetrics;
  private bgGradient: CanvasGradient | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Failed to acquire 2D canvas rendering context.');
    }
    this.ctx = context;
    this.stars = createStarfield(112);

    const rect = canvas.getBoundingClientRect();
    const initialW = rect.width || window.innerWidth || PHYSICS.WORLD_WIDTH;
    const initialH = rect.height || window.innerHeight || PHYSICS.WORLD_HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    this.viewport = this.resize(initialW, initialH, dpr);
  }

  public resize(width: number, height: number, dpr: number): ViewportMetrics {
    const metrics = computeViewportMetrics(width, height, dpr);
    this.viewport = metrics;

    this.canvas.width = Math.round(metrics.width * metrics.dpr);
    this.canvas.height = Math.round(metrics.height * metrics.dpr);
    this.canvas.style.width = `${metrics.width}px`;
    this.canvas.style.height = `${metrics.height}px`;

    this.ctx.setTransform(metrics.dpr, 0, 0, metrics.dpr, 0, 0);
    this.rebuildBackdropGradient();

    return metrics;
  }

  public getViewport(): ViewportMetrics {
    return this.viewport;
  }

  public render(state: GameState): void {
    const ctx = this.ctx;
    const vp = this.viewport;

    ctx.setTransform(vp.dpr, 0, 0, vp.dpr, 0, 0);

    this.drawBackdrop(ctx, vp);
    this.drawStarfield(ctx, vp, state.camera, state.elapsed);
    this.drawTelemetryGrid(ctx, vp, state.camera, state.probe);

    const activeAnchorId =
      state.probe.mode === 'orbiting' ? state.probe.anchorId : null;
    const lockedAnchorId =
      state.aim.active && state.aim.valid ? state.aim.lockedAnchorId : null;

    // Anchors & orbiting hazard drones
    for (let i = 0; i < state.anchors.length; i++) {
      const anchor = state.anchors[i];
      if (!this.isAnchorVisible(anchor, state.camera, vp)) continue;
      this.drawAnchor(
        ctx,
        anchor,
        state.camera,
        vp,
        state.elapsed,
        anchor.id === activeAnchorId,
        anchor.id === lockedAnchorId
      );
    }

    // Collectible energy shards
    for (let i = 0; i < state.shards.length; i++) {
      const shard = state.shards[i];
      if (shard.collected) continue;
      this.drawShard(ctx, shard, state.camera, vp, state.elapsed);
    }

    // Shockwaves (under trajectory & probe)
    for (let i = 0; i < state.shockwaves.length; i++) {
      this.drawShockwave(ctx, state.shockwaves[i], state.camera, vp);
    }

    // Trajectory preview (world-space)
    if (state.aim.active && state.aim.valid && state.aim.trajectory.length > 0) {
      this.drawTrajectoryPreview(ctx, state, vp);
    }

    // Probe motion trail & probe silhouette
    this.drawProbeTrail(ctx, state.probe, state.camera, vp);
    if (state.probe.mode !== 'crashed') {
      this.drawProbe(ctx, state.probe, state.camera, vp, state.elapsed);
    }

    // Particles
    this.drawParticles(ctx, state.particles, state.camera, vp);

    // Floating telemetry popups
    this.drawFloatingTexts(ctx, state.floatingTexts, state.camera, vp);

    // Screen-space slingshot pull indicator
    if (state.aim.active) {
      this.drawAimIndicator(ctx, state);
    }
  }

  private rebuildBackdropGradient(): void {
    const { width, height } = this.viewport;
    const cx = width * 0.5;
    const cy = height * 0.44;
    const maxR = Math.hypot(width * 0.55, height * 0.62);

    const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(0.54, PALETTE.bg);
    grad.addColorStop(1, PALETTE.bgDeep);
    this.bgGradient = grad;
  }

  private drawBackdrop(ctx: CanvasRenderingContext2D, vp: ViewportMetrics): void {
    if (!this.bgGradient) {
      this.rebuildBackdropGradient();
    }
    ctx.fillStyle = this.bgGradient ?? PALETTE.bg;
    ctx.fillRect(0, 0, vp.width, vp.height);
  }

  private drawStarfield(
    ctx: CanvasRenderingContext2D,
    vp: ViewportMetrics,
    camera: CameraState,
    elapsed: number
  ): void {
    const camX = camera.x + camera.shakeOffsetX;
    const camY = camera.y + camera.shakeOffsetY;
    const scale = vp.viewScale;

    for (let i = 0; i < this.stars.length; i++) {
      const star = this.stars[i];
      const sx = mod(star.x * vp.width - camX * star.depth * scale, vp.width);
      const sy = mod(star.y * vp.height - camY * star.depth * scale, vp.height);

      const twinkle =
        0.78 + 0.22 * Math.sin(elapsed * (1.1 + star.depth * 3.2) + star.twinklePhase);
      const alpha = star.alpha * twinkle;

      ctx.globalAlpha = alpha;
      ctx.fillStyle = star.tint;

      if (star.size <= 1.15) {
        ctx.fillRect(sx - star.size * 0.5, sy - star.size * 0.5, star.size, star.size);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, star.size * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
  }

  private drawTelemetryGrid(
    ctx: CanvasRenderingContext2D,
    vp: ViewportMetrics,
    camera: CameraState,
    probe: Probe
  ): void {
    const camX = camera.x + camera.shakeOffsetX;
    const camY = camera.y + camera.shakeOffsetY;
    const scale = vp.viewScale;

    // Subtle parallax coordinate grid
    const gridParallax = 0.65;
    const cellWorld = 104;
    const cellPx = cellWorld * scale;

    if (cellPx >= 24) {
      const originX = vp.width * 0.5 - camX * gridParallax * scale;
      const originY = vp.height * vp.anchorScreenYRatio - camY * gridParallax * scale;

      const offsetX = mod(originX, cellPx);
      const offsetY = mod(originY, cellPx);

      ctx.save();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.04)';
      ctx.lineWidth = 1;
      ctx.beginPath();

      for (let x = offsetX; x <= vp.width; x += cellPx) {
        const px = Math.round(x) + 0.5;
        ctx.moveTo(px, 0);
        ctx.lineTo(px, vp.height);
      }
      for (let y = offsetY; y <= vp.height; y += cellPx) {
        const py = Math.round(y) + 0.5;
        ctx.moveTo(0, py);
        ctx.lineTo(vp.width, py);
      }
      ctx.stroke();

      // Tiny crisp '+' crosshairs at grid intersections
      const arm = 3;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.095)';
      ctx.beginPath();
      for (let x = offsetX; x <= vp.width; x += cellPx) {
        const px = Math.round(x) + 0.5;
        for (let y = offsetY; y <= vp.height; y += cellPx) {
          const py = Math.round(y) + 0.5;
          ctx.moveTo(px - arm, py);
          ctx.lineTo(px + arm, py);
          ctx.moveTo(px, py - arm);
          ctx.lineTo(px, py + arm);
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    // World-locked vertical sector boundary rails (left & right play corridor)
    const halfSector = PHYSICS.WORLD_WIDTH * 0.5;
    const leftScreen = worldToScreen(-halfSector, camY, camera, vp).x;
    const rightScreen = worldToScreen(halfSector, camY, camera, vp).x;

    // Gentle proximity highlight if probe approaches either lateral boundary
    const proximityThreshold = halfSector * 0.68;
    const leftProx =
      probe.mode === 'flying' && probe.x < -proximityThreshold
        ? clamp((-probe.x - proximityThreshold) / (halfSector - proximityThreshold), 0, 1)
        : 0;
    const rightProx =
      probe.mode === 'flying' && probe.x > proximityThreshold
        ? clamp((probe.x - proximityThreshold) / (halfSector - proximityThreshold), 0, 1)
        : 0;

    this.drawSectorRail(ctx, leftScreen, 1, leftProx, camY, vp);
    this.drawSectorRail(ctx, rightScreen, -1, rightProx, camY, vp);
  }

  private drawSectorRail(
    ctx: CanvasRenderingContext2D,
    screenX: number,
    inwardDir: 1 | -1,
    proximity: number,
    camY: number,
    vp: ViewportMetrics
  ): void {
    if (screenX < -16 || screenX > vp.width + 16) return;

    const px = Math.round(screenX) + 0.5;
    const tickSpacingWorld = 80;
    const tickSpacingPx = tickSpacingWorld * vp.viewScale;
    const topWorldY = camY - (vp.height * vp.anchorScreenYRatio) / vp.viewScale - tickSpacingWorld;
    const startTickIndex = Math.floor(topWorldY / tickSpacingWorld);
    const numTicks = Math.ceil(vp.height / tickSpacingPx) + 3;

    ctx.save();

    // Subtle hairline boundary guide
    if (proximity > 0.02) {
      ctx.strokeStyle = `rgba(244, 63, 94, ${(0.1 + proximity * 0.32).toFixed(3)})`;
    } else {
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, vp.height);
    ctx.stroke();

    // Crisp inward tick marks
    ctx.setLineDash([]);
    ctx.strokeStyle =
      proximity > 0.02
        ? `rgba(251, 113, 133, ${(0.18 + proximity * 0.45).toFixed(3)})`
        : 'rgba(148, 163, 184, 0.16)';
    ctx.beginPath();

    for (let i = 0; i < numTicks; i++) {
      const tickIdx = startTickIndex + i;
      const worldY = tickIdx * tickSpacingWorld;
      const screenY =
        vp.height * vp.anchorScreenYRatio + (worldY - camY) * vp.viewScale;
      if (screenY < -10 || screenY > vp.height + 10) continue;

      const py = Math.round(screenY) + 0.5;
      const isMajor = mod(tickIdx, 4) === 0;
      const tickLen = isMajor ? 8 : 4;
      ctx.moveTo(px, py);
      ctx.lineTo(px + inwardDir * tickLen, py);
    }
    ctx.stroke();

    ctx.restore();
  }

  private isAnchorVisible(
    anchor: Anchor,
    camera: CameraState,
    vp: ViewportMetrics
  ): boolean {
    const pos = worldToScreen(anchor.x, anchor.y, camera, vp);
    const margin =
      Math.max(anchor.gravityRange, anchor.captureRadius + anchor.driftAmplitude + 40) *
      vp.viewScale;
    return (
      pos.x >= -margin &&
      pos.x <= vp.width + margin &&
      pos.y >= -margin &&
      pos.y <= vp.height + margin
    );
  }

  private drawAnchor(
    ctx: CanvasRenderingContext2D,
    anchor: Anchor,
    camera: CameraState,
    vp: ViewportMetrics,
    elapsed: number,
    isCurrent: boolean,
    isLocked: boolean
  ): void {
    const scale = vp.viewScale;
    const pos = worldToScreen(anchor.x, anchor.y, camera, vp);
    const captureR = anchor.captureRadius * scale;
    const orbitR = anchor.orbitRadius * scale;
    const coreR = Math.max(5.5, anchor.coreRadius * scale);
    const auraR = Math.max(captureR * 1.38, anchor.gravityRange * 0.72 * scale);

    ctx.save();

    // 1. Drifting anchor rail indicator
    if (anchor.driftAmplitude > 0) {
      const leftPos = worldToScreen(
        anchor.baseX - anchor.driftAmplitude,
        anchor.baseY,
        camera,
        vp
      );
      const rightPos = worldToScreen(
        anchor.baseX + anchor.driftAmplitude,
        anchor.baseY,
        camera,
        vp
      );
      const railY = Math.round(leftPos.y) + 0.5;

      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(leftPos.x, railY);
      ctx.lineTo(rightPos.x, railY);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.34)';
      ctx.beginPath();
      ctx.moveTo(leftPos.x, railY - 4);
      ctx.lineTo(leftPos.x, railY + 4);
      ctx.moveTo(rightPos.x, railY - 4);
      ctx.lineTo(rightPos.x, railY + 4);
      ctx.stroke();
    }

    // 2. Faint gravity well aura
    const auraAlpha = isLocked ? 0.135 : isCurrent ? 0.095 : 0.065;
    const auraGrad = ctx.createRadialGradient(pos.x, pos.y, coreR * 0.6, pos.x, pos.y, auraR);
    if (anchor.hasDecay && anchor.decayActive && anchor.decayDuration > 0) {
      const frac = clamp(anchor.decayRemaining / anchor.decayDuration, 0, 1);
      const c = decayColor(frac);
      auraGrad.addColorStop(0, `rgba(${c.r}, ${c.g}, ${c.b}, ${(auraAlpha * 1.4).toFixed(3)})`);
      auraGrad.addColorStop(0.52, `rgba(${c.r}, ${c.g}, ${c.b}, ${(auraAlpha * 0.45).toFixed(3)})`);
      auraGrad.addColorStop(1, `rgba(${c.r}, ${c.g}, ${c.b}, 0)`);
    } else {
      auraGrad.addColorStop(0, `rgba(56, 189, 248, ${(auraAlpha * 1.25).toFixed(3)})`);
      auraGrad.addColorStop(0.55, `rgba(56, 189, 248, ${(auraAlpha * 0.42).toFixed(3)})`);
      auraGrad.addColorStop(1, 'rgba(56, 189, 248, 0)');
    }
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, auraR, 0, Math.PI * 2);
    ctx.fill();

    // 3. Capture pulse expanding ring
    if (anchor.capturePulse > 0) {
      const pulse = clamp(anchor.capturePulse, 0, 1);
      const expandProgress = 1 - pulse;
      const pulseR = lerp(orbitR, captureR * 1.32, 1 - Math.pow(1 - expandProgress, 2));
      ctx.strokeStyle = `rgba(125, 211, 252, ${(pulse * 0.72).toFixed(3)})`;
      ctx.lineWidth = 1.2 + pulse * 1.8;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pulseR, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 4. Dashed/segmented capture ring
    const ringRot = elapsed * 0.14 * (anchor.index % 2 === 0 ? 1 : -1);
    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(ringRot);
    ctx.strokeStyle = isLocked
      ? 'rgba(56, 189, 248, 0.88)'
      : isCurrent
        ? 'rgba(56, 189, 248, 0.42)'
        : anchor.visited
          ? 'rgba(148, 163, 184, 0.22)'
          : 'rgba(56, 189, 248, 0.32)';
    ctx.lineWidth = isLocked ? 1.8 : 1.15;
    const dashLen = Math.max(5, captureR * 0.16);
    const gapLen = Math.max(4, captureR * 0.11);
    ctx.setLineDash([dashLen, gapLen]);
    ctx.beginPath();
    ctx.arc(0, 0, captureR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // 5. Lock-on corner brackets / ticks around capture ring
    if (isLocked) {
      const breathe = Math.sin(elapsed * 9) * 2.2;
      const bracketR = captureR + 6 + breathe;
      const arcSpan = 0.22;
      ctx.strokeStyle = PALETTE.cyanSoft;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';

      for (let q = 0; q < 4; q++) {
        const midAngle = Math.PI * 0.25 + q * (Math.PI * 0.5);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, bracketR, midAngle - arcSpan, midAngle + arcSpan);
        ctx.stroke();

        // Crisp tiny inward tick at bracket center
        const cosA = Math.cos(midAngle);
        const sinA = Math.sin(midAngle);
        ctx.beginPath();
        ctx.moveTo(pos.x + cosA * bracketR, pos.y + sinA * bracketR);
        ctx.lineTo(pos.x + cosA * (bracketR - 4.5), pos.y + sinA * (bracketR - 4.5));
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    // 6. Subtle orbit track circle
    ctx.strokeStyle = isCurrent
      ? 'rgba(125, 211, 252, 0.36)'
      : isLocked
        ? 'rgba(56, 189, 248, 0.38)'
        : 'rgba(148, 163, 184, 0.18)';
    ctx.lineWidth = isCurrent ? 1.35 : 1;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, orbitR, 0, Math.PI * 2);
    ctx.stroke();

    // 7. Decay ring (active or subtle preview if armed on unvisited anchor)
    if (anchor.hasDecay) {
      const decayR = orbitR + Math.max(4, 5 * scale);
      if (anchor.decayActive && anchor.decayDuration > 0) {
        const frac = clamp(anchor.decayRemaining / anchor.decayDuration, 0, 1);
        const c = decayColor(frac);
        const urgentPulse =
          frac < 0.28 ? 0.72 + 0.28 * Math.sin(elapsed * 20) : 1;

        // Track background
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
        ctx.lineWidth = Math.max(2, 2.4 * scale);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, decayR, 0, Math.PI * 2);
        ctx.stroke();

        // Active radial progress sweep from -PI/2
        if (frac > 0.002) {
          const startAngle = -Math.PI * 0.5;
          const endAngle = startAngle + Math.PI * 2 * frac;

          // Faint urgency halo when critical
          if (frac < 0.28) {
            ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${(0.28 * urgentPulse).toFixed(3)})`;
            ctx.lineWidth = Math.max(5.5, 6.5 * scale);
            ctx.beginPath();
            ctx.arc(pos.x, pos.y, decayR, startAngle, endAngle);
            ctx.stroke();
          }

          ctx.strokeStyle = `rgba(${c.r}, ${c.g}, ${c.b}, ${(0.95 * urgentPulse).toFixed(3)})`;
          ctx.lineWidth = Math.max(2.2, 2.8 * scale);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, decayR, startAngle, endAngle);
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
      } else if (!anchor.visited) {
        // Subtle pre-landing cue that this anchor has a decay timer
        ctx.strokeStyle = 'rgba(245, 184, 65, 0.22)';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, decayR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // 8. Hazard drone orbit paths & drones
    if (anchor.drones.length > 0) {
      const drawnRadii = new Set<number>();
      for (let i = 0; i < anchor.drones.length; i++) {
        const drone = anchor.drones[i];
        const radiusKey = Math.round(drone.orbitRadius * 10);
        if (!drawnRadii.has(radiusKey)) {
          drawnRadii.add(radiusKey);
          ctx.strokeStyle = 'rgba(244, 63, 94, 0.18)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 5]);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, drone.orbitRadius * scale, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      for (let i = 0; i < anchor.drones.length; i++) {
        const drone = anchor.drones[i];
        const dPos = worldToScreen(drone.x, drone.y, camera, vp);
        const dRadius = Math.max(4.5, drone.radius * scale);
        const tangentAngle =
          drone.angle + (drone.angularSpeed >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);

        ctx.save();
        ctx.translate(dPos.x, dPos.y);

        // Subtle coral aura
        const dGlow = ctx.createRadialGradient(0, 0, 0, 0, 0, dRadius * 2.2);
        dGlow.addColorStop(0, 'rgba(244, 63, 94, 0.34)');
        dGlow.addColorStop(1, 'rgba(244, 63, 94, 0)');
        ctx.fillStyle = dGlow;
        ctx.beginPath();
        ctx.arc(0, 0, dRadius * 2.2, 0, Math.PI * 2);
        ctx.fill();

        // Oriented coral chevron / diamond satellite
        ctx.rotate(tangentAngle);
        ctx.beginPath();
        ctx.moveTo(dRadius * 1.35, 0);
        ctx.lineTo(-dRadius * 0.55, dRadius * 0.92);
        ctx.lineTo(-dRadius * 1.0, 0);
        ctx.lineTo(-dRadius * 0.55, -dRadius * 0.92);
        ctx.closePath();
        ctx.fillStyle = PALETTE.coral;
        ctx.fill();
        ctx.strokeStyle = PALETTE.coralSoft;
        ctx.lineWidth = 1;
        ctx.stroke();

        // Bright coral-white core
        ctx.fillStyle = '#FFF1F2';
        ctx.beginPath();
        ctx.arc(dRadius * 0.12, 0, Math.max(1.5, dRadius * 0.3), 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      }
    }

    // 9. Anchor Core Disc
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, coreR, 0, Math.PI * 2);
    ctx.fillStyle = '#131D30';
    ctx.fill();

    const coreStroke = isLocked
      ? PALETTE.cyanSoft
      : isCurrent
        ? PALETTE.cyan
        : anchor.visited
          ? PALETTE.slateMuted
          : PALETTE.slateLight;
    ctx.strokeStyle = coreStroke;
    ctx.lineWidth = isLocked || isCurrent ? 1.8 : 1.35;
    ctx.stroke();

    // Subtle concentric inner ring
    if (coreR >= 8) {
      ctx.strokeStyle = isCurrent || isLocked
        ? 'rgba(56, 189, 248, 0.28)'
        : 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, coreR * 0.72, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Tiny telemetry index label or pinpoint core dot
    if (coreR >= 10.5) {
      const label = String(anchor.index).padStart(2, '0');
      const fontSize = Math.max(8, Math.round(coreR * 0.62));
      ctx.font = `600 ${fontSize}px ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isCurrent || isLocked ? PALETTE.white : PALETTE.slate;
      ctx.fillText(label, pos.x, pos.y + 0.5);
    } else {
      ctx.fillStyle = isCurrent || isLocked ? PALETTE.cyan : PALETTE.slateLight;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, Math.max(2, coreR * 0.24), 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawShard(
    ctx: CanvasRenderingContext2D,
    shard: EnergyShard,
    camera: CameraState,
    vp: ViewportMetrics,
    elapsed: number
  ): void {
    const pos = worldToScreen(shard.x, shard.y, camera, vp);
    const r = Math.max(5, shard.radius * vp.viewScale);
    if (
      pos.x < -r * 3 ||
      pos.x > vp.width + r * 3 ||
      pos.y < -r * 3 ||
      pos.y > vp.height + r * 3
    ) {
      return;
    }

    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.4 + shard.pulsePhase);
    const rot = elapsed * 1.6 + shard.pulsePhase;

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Warm subtle radial glow
    const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.4);
    glow.addColorStop(0, `rgba(245, 184, 65, ${(0.28 + pulse * 0.12).toFixed(3)})`);
    glow.addColorStop(1, 'rgba(245, 184, 65, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Subtle breathing outer ring
    ctx.strokeStyle = `rgba(245, 184, 65, ${(0.2 + (1 - pulse) * 0.24).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * (1.28 + pulse * 0.42), 0, Math.PI * 2);
    ctx.stroke();

    // Crisp rotating diamond / octahedron
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(0, -r * 1.15);
    ctx.lineTo(r * 0.82, 0);
    ctx.lineTo(0, r * 1.15);
    ctx.lineTo(-r * 0.82, 0);
    ctx.closePath();
    ctx.fillStyle = PALETTE.gold;
    ctx.fill();
    ctx.strokeStyle = PALETTE.goldSoft;
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // Inner bright highlight facet
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.56);
    ctx.lineTo(r * 0.4, 0);
    ctx.lineTo(0, r * 0.56);
    ctx.lineTo(-r * 0.4, 0);
    ctx.closePath();
    ctx.fillStyle = '#FEF3C7';
    ctx.fill();

    ctx.restore();
  }

  private drawTrajectoryPreview(
    ctx: CanvasRenderingContext2D,
    state: GameState,
    vp: ViewportMetrics
  ): void {
    const { trajectory, hitsHazard, lockedAnchorId } = state.aim;
    const count = trajectory.length;
    if (count === 0) return;

    ctx.save();

    let lastX = 0;
    let lastY = 0;

    for (let i = 0; i < count; i++) {
      const pt = trajectory[i];
      const screen = worldToScreen(pt.x, pt.y, state.camera, vp);
      lastX = screen.x;
      lastY = screen.y;

      const t = count > 1 ? i / (count - 1) : 0;
      const radius = lerp(3.1, 1.15, t);
      const alpha = lerp(0.92, 0.18, Math.pow(t, 0.85));

      let r = 56;
      let g = 189;
      let b = 248;

      if (hitsHazard && t > 0.42) {
        const hazardBlend = clamp((t - 0.42) / 0.36, 0, 1);
        r = Math.round(lerp(56, 244, hazardBlend));
        g = Math.round(lerp(189, 63, hazardBlend));
        b = Math.round(lerp(248, 94, hazardBlend));
      }

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // End marker: target reticle on lock-on, or warning cross on hazard hit
    if (hitsHazard) {
      const arm = 5.5;
      ctx.strokeStyle = PALETTE.coral;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(lastX - arm, lastY - arm);
      ctx.lineTo(lastX + arm, lastY + arm);
      ctx.moveTo(lastX + arm, lastY - arm);
      ctx.lineTo(lastX - arm, lastY + arm);
      ctx.stroke();
    } else if (lockedAnchorId !== null) {
      const reticleR = 7;
      ctx.strokeStyle = PALETTE.cyanSoft;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(lastX, lastY, reticleR, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(lastX - reticleR - 3, lastY);
      ctx.lineTo(lastX - reticleR + 2, lastY);
      ctx.moveTo(lastX + reticleR - 2, lastY);
      ctx.lineTo(lastX + reticleR + 3, lastY);
      ctx.moveTo(lastX, lastY - reticleR - 3);
      ctx.lineTo(lastX, lastY - reticleR + 2);
      ctx.moveTo(lastX, lastY + reticleR - 2);
      ctx.lineTo(lastX, lastY + reticleR + 3);
      ctx.stroke();

      ctx.fillStyle = PALETTE.white;
      ctx.beginPath();
      ctx.arc(lastX, lastY, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private drawProbeTrail(
    ctx: CanvasRenderingContext2D,
    probe: Probe,
    camera: CameraState,
    vp: ViewportMetrics
  ): void {
    const trail = probe.trail;
    const len = trail.length;
    if (len < 2) return;

    const maxAge = Math.max(0.42, trail[0].age, trail[len - 1].age);
    const maxWidth = Math.max(2.6, 4.4 * vp.viewScale);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < len - 1; i++) {
      const p0 = trail[i];
      const p1 = trail[i + 1];
      const avgAge = (p0.age + p1.age) * 0.5;
      const freshness = clamp(1 - avgAge / maxAge, 0, 1);
      if (freshness <= 0.01) continue;

      const s0 = worldToScreen(p0.x, p0.y, camera, vp);
      const s1 = worldToScreen(p1.x, p1.y, camera, vp);

      const width = Math.max(0.6, maxWidth * freshness);
      const alpha = freshness * freshness * 0.68;

      ctx.strokeStyle = `rgba(56, 189, 248, ${alpha.toFixed(3)})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(s0.x, s0.y);
      ctx.lineTo(s1.x, s1.y);
      ctx.stroke();

      // Thin bright inner core on freshest tail segments
      if (freshness > 0.55) {
        const coreAlpha = (freshness - 0.55) / 0.45 * 0.52;
        ctx.strokeStyle = `rgba(224, 242, 254, ${coreAlpha.toFixed(3)})`;
        ctx.lineWidth = Math.max(0.75, width * 0.36);
        ctx.beginPath();
        ctx.moveTo(s0.x, s0.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  private drawProbe(
    ctx: CanvasRenderingContext2D,
    probe: Probe,
    camera: CameraState,
    vp: ViewportMetrics,
    elapsed: number
  ): void {
    const pos = worldToScreen(probe.x, probe.y, camera, vp);
    const r = Math.max(5.5, probe.radius * vp.viewScale);

    let heading: number;
    if (probe.mode === 'flying' && Math.hypot(probe.vx, probe.vy) > 1) {
      heading = Math.atan2(probe.vy, probe.vx);
    } else if (probe.mode === 'orbiting') {
      heading = probe.orbitAngle + (probe.orbitDirection >= 0 ? Math.PI * 0.5 : -Math.PI * 0.5);
    } else {
      heading = -Math.PI * 0.5;
    }

    ctx.save();
    ctx.translate(pos.x, pos.y);

    // Subtle cyan halo
    const halo = ctx.createRadialGradient(0, 0, r * 0.2, 0, 0, r * 2.8);
    halo.addColorStop(0, 'rgba(56, 189, 248, 0.34)');
    halo.addColorStop(0.55, 'rgba(56, 189, 248, 0.1)');
    halo.addColorStop(1, 'rgba(56, 189, 248, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, r * 2.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.rotate(heading);

    // Thruster accent plume at aft end
    const thrustPulse = probe.mode === 'flying' ? 0.85 + 0.15 * Math.sin(elapsed * 42) : 0.65;
    ctx.fillStyle = PALETTE.cyan;
    ctx.beginPath();
    ctx.moveTo(-r * 0.72, -r * 0.34);
    ctx.lineTo(-r * (1.28 + 0.35 * thrustPulse), 0);
    ctx.lineTo(-r * 0.72, r * 0.34);
    ctx.closePath();
    ctx.fill();

    // Precision white triangular/capsule probe silhouette
    ctx.beginPath();
    ctx.moveTo(r * 1.38, 0);
    ctx.lineTo(-r * 0.78, r * 0.82);
    ctx.lineTo(-r * 0.45, 0);
    ctx.lineTo(-r * 0.78, -r * 0.82);
    ctx.closePath();
    ctx.fillStyle = PALETTE.white;
    ctx.fill();

    // Subtle center telemetry accent stripe
    ctx.fillStyle = PALETTE.cyan;
    ctx.beginPath();
    ctx.arc(r * 0.14, 0, Math.max(1.4, r * 0.24), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  private drawShockwave(
    ctx: CanvasRenderingContext2D,
    wave: Shockwave,
    camera: CameraState,
    vp: ViewportMetrics
  ): void {
    const remaining = wave.maxLife > 0 ? clamp(1 - wave.life / wave.maxLife, 0, 1) : 0;
    if (remaining <= 0.005) return;

    const pos = worldToScreen(wave.x, wave.y, camera, vp);
    const r = Math.max(1, wave.radius * vp.viewScale);

    ctx.save();
    ctx.globalAlpha = Math.pow(remaining, 1.25) * 0.85;
    ctx.strokeStyle = wave.color;
    ctx.lineWidth = Math.max(0.75, wave.lineWidth * (0.35 + 0.65 * remaining));
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  private drawParticles(
    ctx: CanvasRenderingContext2D,
    particles: Particle[],
    camera: CameraState,
    vp: ViewportMetrics
  ): void {
    if (particles.length === 0) return;

    ctx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const remaining = p.maxLife > 0 ? clamp(1 - p.life / p.maxLife, 0, 1) : 0;
      if (remaining <= 0.01) continue;

      const pos = worldToScreen(p.x, p.y, camera, vp);
      const size = Math.max(0.8, p.size * vp.viewScale * (0.35 + 0.65 * remaining));
      const alpha = clamp(p.alpha, 0, 1);

      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFloatingTexts(
    ctx: CanvasRenderingContext2D,
    texts: FloatingText[],
    camera: CameraState,
    vp: ViewportMetrics
  ): void {
    if (texts.length === 0) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let i = 0; i < texts.length; i++) {
      const item = texts[i];
      const remaining = item.maxLife > 0 ? clamp(1 - item.life / item.maxLife, 0, 1) : 0;
      if (remaining <= 0.01) continue;

      const progress = 1 - remaining;
      const fadeIn = clamp(progress / 0.12, 0, 1);
      const fadeOut = clamp(remaining / 0.42, 0, 1);
      const alpha = Math.min(fadeIn, fadeOut);
      const popScale = lerp(0.84, 1, fadeIn);
      const fontSize = Math.max(11, Math.round(13.5 * item.scale * popScale));

      const pos = worldToScreen(item.x, item.y, camera, vp);

      ctx.globalAlpha = alpha;
      ctx.font = `700 ${fontSize}px ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace`;

      // Subtle obsidian backing stroke for legibility over bright stars/rings
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(7, 11, 19, 0.82)';
      ctx.strokeText(item.text, pos.x, pos.y);

      ctx.fillStyle = item.color;
      ctx.fillText(item.text, pos.x, pos.y);
    }

    ctx.restore();
  }

  private drawAimIndicator(ctx: CanvasRenderingContext2D, state: GameState): void {
    const { startScreen, currentScreen, power, valid, hitsHazard } = state.aim;
    const dx = currentScreen.x - startScreen.x;
    const dy = currentScreen.y - startScreen.y;
    const dist = Math.hypot(dx, dy);

    const accent = !valid
      ? PALETTE.slateMuted
      : hitsHazard
        ? PALETTE.coralSoft
        : power >= 0.82
          ? PALETTE.gold
          : PALETTE.cyan;

    const accentRgba = !valid
      ? 'rgba(148, 163, 184, 0.36)'
      : hitsHazard
        ? 'rgba(244, 63, 94, 0.45)'
        : power >= 0.82
          ? 'rgba(245, 184, 65, 0.5)'
          : 'rgba(56, 189, 248, 0.48)';

    ctx.save();

    // Subtle deadzone/cancel boundary ring around drag origin
    ctx.strokeStyle = valid
      ? 'rgba(148, 163, 184, 0.16)'
      : 'rgba(148, 163, 184, 0.34)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.arc(startScreen.x, startScreen.y, PHYSICS.MIN_PULL_PX, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Origin precision ring
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(startScreen.x, startScreen.y, 6, 0, Math.PI * 2);
    ctx.stroke();

    // Tension line from origin to drag handle
    if (dist > 2) {
      ctx.strokeStyle = accentRgba;
      ctx.lineWidth = valid ? 1.75 : 1.15;
      ctx.beginPath();
      ctx.moveTo(startScreen.x, startScreen.y);
      ctx.lineTo(currentScreen.x, currentScreen.y);
      ctx.stroke();

      // Short directional chevron on opposite (launch) side of origin when valid
      if (valid) {
        const ux = -dx / dist;
        const uy = -dy / dist;
        const tipDist = 18 + power * 10;
        const tipX = startScreen.x + ux * tipDist;
        const tipY = startScreen.y + uy * tipDist;
        const perpX = -uy;
        const perpY = ux;

        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startScreen.x + ux * 9, startScreen.y + uy * 9);
        ctx.lineTo(tipX, tipY);
        ctx.moveTo(tipX - ux * 5 + perpX * 4, tipY - uy * 5 + perpY * 4);
        ctx.lineTo(tipX, tipY);
        ctx.lineTo(tipX - ux * 5 - perpX * 4, tipY - uy * 5 - perpY * 4);
        ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }

    // Drag handle ring & dot
    ctx.beginPath();
    ctx.arc(currentScreen.x, currentScreen.y, valid ? 9 : 6.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(11, 16, 27, 0.72)';
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = valid ? 1.8 : 1.25;
    ctx.stroke();

    ctx.fillStyle = valid ? accent : PALETTE.slate;
    ctx.beginPath();
    ctx.arc(currentScreen.x, currentScreen.y, valid ? 3 : 2, 0, Math.PI * 2);
    ctx.fill();

    // Subtle telemetry power percentage readout near handle
    if (valid) {
      const pct = `${Math.round(clamp(power, 0, 1) * 100)}%`;
      ctx.font =
        "600 10px ui-monospace, 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, monospace";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = accent;
      ctx.fillText(pct, currentScreen.x, currentScreen.y + 14);
    }

    ctx.restore();
  }
}
