export interface Vec2 {
  x: number;
  y: number;
}

export type GameStatus = 'ready' | 'playing' | 'gameover' | 'victory';

export type GameMode = 'endless' | 'adventure';

export type ProbeMode = 'orbiting' | 'flying' | 'crashed';

export type GameOverReason =
  | 'OUT_OF_SECTOR'
  | 'ORBIT_DECAYED'
  | 'DRONE_COLLISION'
  | 'REPULSOR_IMPACT';

export type RunTraceStep = 'capture' | 'skip' | 'boost' | 'deflect' | 'goal' | 'crash';

export interface ShieldArc {
  /** Center angle of the deflecting coral shield arc (radians) */
  angle: number;
  /** Signed rotation speed (rad/s) */
  angularSpeed: number;
  /** Angular width of the shield arc (radians, always < PI so an open entry gap exists) */
  arcSpan: number;
}

export interface RepulsorNode {
  id: number;
  x: number;
  y: number;
  coreRadius: number;
  /** Repulsive anti-gravity strength in world units^3 / s^2 */
  strength: number;
  /** Effective outer radius of the repulsive field */
  range: number;
  pulsePhase: number;
}

export interface HazardDrone {
  id: number;
  orbitRadius: number;
  angle: number;
  angularSpeed: number; // rad/s (signed for CW/CCW)
  radius: number;
  /** World-space position kept up-to-date each physics step */
  x: number;
  y: number;
}

export interface Anchor {
  id: number;
  index: number; // 0 = starting anchor, increments upward
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  coreRadius: number;
  orbitRadius: number;
  captureRadius: number;
  gravityStrength: number; // GM constant in world units^3 / s^2
  gravityRange: number;
  /** Horizontal drift parameters (active on higher scores) */
  driftAmplitude: number;
  driftSpeed: number;
  driftPhase: number;
  /** Decay ring state once captured */
  hasDecay: boolean;
  decayDuration: number; // total seconds before collapse
  decayRemaining: number; // remaining seconds
  decayActive: boolean;
  visited: boolean;
  /** True for the final Extraction Goal anchor in Adventure sectors */
  isGoal: boolean;
  /** Launch speed multiplier when slinging from this anchor (1.0 normal, >1.0 Boost/Overdrive) */
  boostMultiplier: number;
  /** Optional rotating coral deflector shield around the capture ring */
  shield: ShieldArc | null;
  /** Visual capture pulse timer (0..1, decays to 0) */
  capturePulse: number;
  /** Visual shield deflection flash timer (0..1, decays to 0) */
  deflectPulse: number;
  drones: HazardDrone[];
}

export interface EnergyShard {
  id: number;
  x: number;
  y: number;
  radius: number;
  collected: boolean;
  pulsePhase: number;
  value: number;
}

export interface TrailPoint {
  x: number;
  y: number;
  age: number; // seconds since recorded
}

export interface Probe {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mode: ProbeMode;
  anchorId: number | null;
  launchAnchorId: number | null;
  flightTime: number;
  orbitAngle: number;
  orbitAngularSpeed: number; // signed rad/s
  orbitDirection: 1 | -1;
  /** Smoothly blends radial distance into anchor.orbitRadius on capture */
  orbitRadiusCurrent: number;
  trail: TrailPoint[];
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  alpha: number;
  life: number;
  maxLife: number;
}

export interface Shockwave {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  color: string;
  life: number;
  maxLife: number;
  lineWidth: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  life: number;
  maxLife: number;
  scale: number;
}

export interface TrajectoryPoint {
  x: number;
  y: number;
  t: number;
}

export interface AimState {
  active: boolean;
  /** Screen-space drag origin and current point (CSS pixels) */
  startScreen: Vec2;
  currentScreen: Vec2;
  /** Normalized power 0..1 */
  power: number;
  /** True when pull distance exceeds minimum launch threshold */
  valid: boolean;
  /** Computed launch velocity vector in world units/s */
  launchVelocity: Vec2;
  /** Predicted trajectory computed with exact engine gravity step */
  trajectory: TrajectoryPoint[];
  /** Anchor ID intersected by the predicted trajectory, if any */
  lockedAnchorId: number | null;
  /** True if predicted trajectory hits a hazard drone or repulsor core */
  hitsHazard: boolean;
  /** True if predicted trajectory bounces off a rotating shield arc */
  deflectsOffShield: boolean;
}

export interface CameraState {
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  shakeMagnitude: number;
  shakeOffsetX: number;
  shakeOffsetY: number;
}

export interface Star {
  /** Normalized wrap coordinates in parallax space */
  x: number;
  y: number;
  size: number;
  alpha: number;
  depth: number; // 0.12 (far) .. 0.45 (near)
  twinklePhase: number;
  tint: string;
}

export interface ChapterDefinition {
  id: number; // 1..5
  code: string; // '01'..'05'
  name: string;
  tagline: string;
  accent: 'cyan' | 'coral' | 'gold';
  startSectorId: number;
  endSectorId: number;
}

export interface SectorDefinition {
  id: number;
  chapterId: number;
  code: string;
  name: string;
  subtitle: string;
  seed: string;
  anchorCount: number;
  captureRadiusScale: number;
  gravityMultiplier: number;
  /** Seconds before collapse, or 0 for no decay */
  decayDuration: number;
  driftChance: number;
  driftSpeedScale: number;
  droneChance: number;
  dualDroneChance: number;
  droneSpeedScale: number;
  /** Probability of spawning a flanking Repulsor (-G) node between anchors */
  repulsorChance: number;
  repulsorStrengthScale: number;
  /** Probability of equipping an intermediate anchor with a rotating Shield Arc */
  shieldChance: number;
  shieldSpeedScale: number;
  /** Probability of making an intermediate anchor an Overdrive Boost anchor (with wider next gap) */
  boostChance: number;
  boostMultiplier: number;
  /** Fraction of total sector shards required for the Shard star (0..1) */
  shardStarRatio: number;
  minComboForStar: number;
}

export interface SectorProgress {
  cleared: boolean;
  stars: number; // 0..3
  bestScore: number;
}

export interface AdventureRunSummary {
  sectorId: number;
  sectorCode: string;
  sectorName: string;
  starsEarned: number;
  starCleared: boolean;
  starShards: boolean;
  starCombo: boolean;
  shardsCollected: number;
  totalShards: number;
  shardTarget: number;
  maxCombo: number;
  comboTarget: number;
  hasNextSector: boolean;
}

export type GameEvent =
  | { type: 'launch'; power: number; boosted?: boolean }
  | { type: 'capture'; combo: number; points: number; skipped: number; isNewAnchor: boolean }
  | { type: 'deflect' }
  | { type: 'shard'; combo: number; points: number }
  | { type: 'decayWarning'; urgency: number }
  | { type: 'crash'; reason: GameOverReason }
  | { type: 'victory'; sectorId: number; stars: number };

export interface ViewportMetrics {
  width: number; // CSS pixels
  height: number; // CSS pixels
  dpr: number;
  viewScale: number;
  anchorScreenYRatio: number; // vertical screen ratio for camera.y (0.68)
}

export interface GameState {
  status: GameStatus;
  mode: GameMode;
  score: number;
  bestScore: number;
  isNewBest: boolean;
  combo: number;
  maxCombo: number;
  anchorsCaptured: number;
  shardsCollected: number;
  runTrace: RunTraceStep[];
  adventureSectorId: number;
  adventureTotalAnchors: number;
  adventureCurrentAnchorIndex: number;
  adventureTotalShards: number;
  adventureSummary: AdventureRunSummary | null;
  gameOverReason: GameOverReason | null;
  gameOverElapsed: number;
  elapsed: number;
  hitStopRemaining: number;
  probe: Probe;
  anchors: Anchor[];
  repulsors: RepulsorNode[];
  shards: EnergyShard[];
  particles: Particle[];
  shockwaves: Shockwave[];
  floatingTexts: FloatingText[];
  aim: AimState;
  camera: CameraState;
}

export const PALETTE = {
  bg: '#0B101B',
  bgDeep: '#070B13',
  cyan: '#38BDF8',
  cyanSoft: '#7DD3FC',
  gold: '#F5B841',
  goldSoft: '#FCD34D',
  coral: '#F43F5E',
  coralSoft: '#FB7185',
  white: '#F8FAFC',
  slateLight: '#CBD5E1',
  slate: '#94A3B8',
  slateMuted: '#475569',
  slateDark: '#1E293B',
} as const;

export const PHYSICS = {
  FIXED_DT: 1 / 120,
  WORLD_WIDTH: 520,
  WORLD_HEIGHT: 760,
  ANCHOR_SCREEN_Y_RATIO: 0.68,
  MIN_PULL_PX: 16,
  MAX_PULL_PX: 145,
  MIN_LAUNCH_SPEED: 290,
  MAX_LAUNCH_SPEED: 740,
  LAUNCH_GRACE_TIME: 0.28,
  AIM_TIME_SCALE: 0.42,
  TRAJECTORY_STEPS: 108,
  TRAJECTORY_SAMPLE_STRIDE: 3,
} as const;

export function computeViewportMetrics(width: number, height: number, dpr: number): ViewportMetrics {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const viewScale = Math.min(safeW / PHYSICS.WORLD_WIDTH, safeH / PHYSICS.WORLD_HEIGHT);
  return {
    width: safeW,
    height: safeH,
    dpr: Math.max(1, Math.min(dpr, 3)),
    viewScale,
    anchorScreenYRatio: PHYSICS.ANCHOR_SCREEN_Y_RATIO,
  };
}

export function worldToScreen(
  worldX: number,
  worldY: number,
  camera: CameraState,
  viewport: ViewportMetrics
): Vec2 {
  const cx = camera.x + camera.shakeOffsetX;
  const cy = camera.y + camera.shakeOffsetY;
  return {
    x: viewport.width * 0.5 + (worldX - cx) * viewport.viewScale,
    y: viewport.height * viewport.anchorScreenYRatio + (worldY - cy) * viewport.viewScale,
  };
}

export function screenToWorld(
  screenX: number,
  screenY: number,
  camera: CameraState,
  viewport: ViewportMetrics
): Vec2 {
  return {
    x: (screenX - viewport.width * 0.5) / viewport.viewScale + camera.x,
    y: (screenY - viewport.height * viewport.anchorScreenYRatio) / viewport.viewScale + camera.y,
  };
}

