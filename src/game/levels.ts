import type { ChapterDefinition, SectorDefinition, SectorProgress } from './types';

const ADVENTURE_PROGRESS_STORAGE_KEY = 'orbit-sling-adventure-v1';

export const ADVENTURE_CHAPTERS: readonly ChapterDefinition[] = [
  {
    id: 1,
    code: '01',
    name: 'LOW ORBIT',
    tagline: 'Core slingshot, decay rings, drones & lateral drift',
    accent: 'cyan',
    startSectorId: 1,
    endSectorId: 10,
  },
  {
    id: 2,
    code: '02',
    name: 'REPULSOR FIELD',
    tagline: 'Anti-gravity (-G) nodes bend trajectories outward',
    accent: 'coral',
    startSectorId: 11,
    endSectorId: 20,
  },
  {
    id: 3,
    code: '03',
    name: 'AEGIS ARRAY',
    tagline: 'Rotating coral shields deflect off-angle entries',
    accent: 'coral',
    startSectorId: 21,
    endSectorId: 30,
  },
  {
    id: 4,
    code: '04',
    name: 'OVERDRIVE RELAY',
    tagline: 'Boost anchors supercharge launches across wide gaps',
    accent: 'gold',
    startSectorId: 31,
    endSectorId: 40,
  },
  {
    id: 5,
    code: '05',
    name: 'EVENT HORIZON',
    tagline: 'All orbital systems combined · Final extraction',
    accent: 'gold',
    startSectorId: 41,
    endSectorId: 50,
  },
] as const;

interface ChapterSectorSpec {
  name: string;
  subtitle: string;
  anchorCount: number;
  captureRadiusScale: number;
  gravityMultiplier: number;
  decayDuration: number;
  driftChance: number;
  driftSpeedScale?: number;
  droneChance: number;
  dualDroneChance?: number;
  droneSpeedScale?: number;
  repulsorChance?: number;
  repulsorStrengthScale?: number;
  shieldChance?: number;
  shieldSpeedScale?: number;
  boostChance?: number;
  boostMultiplier?: number;
  shardStarRatio: number;
  minComboForStar: number;
}

function buildChapterSectors(
  chapterId: number,
  startId: number,
  specs: readonly ChapterSectorSpec[]
): SectorDefinition[] {
  return specs.map((spec, idx) => {
    const id = startId + idx;
    const code = String(id).padStart(2, '0');
    const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return {
      id,
      chapterId,
      code,
      name: spec.name,
      subtitle: spec.subtitle,
      seed: `sector-${code}-${slug}-v1`,
      anchorCount: spec.anchorCount,
      captureRadiusScale: spec.captureRadiusScale,
      gravityMultiplier: spec.gravityMultiplier,
      decayDuration: spec.decayDuration,
      driftChance: spec.driftChance,
      driftSpeedScale: spec.driftSpeedScale ?? 1.0,
      droneChance: spec.droneChance,
      dualDroneChance: spec.dualDroneChance ?? 0,
      droneSpeedScale: spec.droneSpeedScale ?? 1.0,
      repulsorChance: spec.repulsorChance ?? 0,
      repulsorStrengthScale: spec.repulsorStrengthScale ?? 1.0,
      shieldChance: spec.shieldChance ?? 0,
      shieldSpeedScale: spec.shieldSpeedScale ?? 1.0,
      boostChance: spec.boostChance ?? 0,
      boostMultiplier: spec.boostMultiplier ?? 1.0,
      shardStarRatio: spec.shardStarRatio,
      minComboForStar: spec.minComboForStar,
    };
  });
}

// Chapter 1 (01-10): LOW ORBIT — preserves original calibrated Sectors 01-10
const CHAPTER_1_SPECS: readonly ChapterSectorSpec[] = [
  { name: 'CALIBRATION', subtitle: 'Stable orbits · Learn the slingshot arc', anchorCount: 6, captureRadiusScale: 1.06, gravityMultiplier: 1.0, decayDuration: 0, driftChance: 0, droneChance: 0, shardStarRatio: 0.5, minComboForStar: 3 },
  { name: 'GRAVITY BEND', subtitle: 'Stronger pull · Curve shots through shards', anchorCount: 7, captureRadiusScale: 1.0, gravityMultiplier: 1.24, decayDuration: 7.4, driftChance: 0, droneChance: 0, shardStarRatio: 0.55, minComboForStar: 3 },
  { name: 'DECAY RUSH', subtitle: 'Unstable anchors · Keep moving upward', anchorCount: 7, captureRadiusScale: 0.98, gravityMultiplier: 1.08, decayDuration: 4.9, driftChance: 0, droneChance: 0, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'PATROL RING', subtitle: 'Hazard drones · Time your entry window', anchorCount: 8, captureRadiusScale: 0.96, gravityMultiplier: 1.05, decayDuration: 6.0, driftChance: 0, droneChance: 0.72, droneSpeedScale: 0.95, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'DRIFTING ORBIT', subtitle: 'Lateral drift · Lead moving anchors', anchorCount: 8, captureRadiusScale: 0.95, gravityMultiplier: 1.08, decayDuration: 5.8, driftChance: 0.72, driftSpeedScale: 0.95, droneChance: 0.35, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'TWIN SENTINELS', subtitle: 'Dual patrol drones · Thread the gap', anchorCount: 8, captureRadiusScale: 0.93, gravityMultiplier: 1.1, decayDuration: 5.5, driftChance: 0.25, droneChance: 0.85, dualDroneChance: 0.55, droneSpeedScale: 1.02, shardStarRatio: 0.6, minComboForStar: 4 },
  { name: 'HIGH-G WELLS', subtitle: 'Heavy gravity · Master curved slingshots', anchorCount: 9, captureRadiusScale: 0.92, gravityMultiplier: 1.52, decayDuration: 5.4, driftChance: 0.4, droneChance: 0.55, dualDroneChance: 0.2, droneSpeedScale: 1.05, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'NARROW CORRIDOR', subtitle: 'Tight capture rings · Precision launches', anchorCount: 9, captureRadiusScale: 0.85, gravityMultiplier: 1.16, decayDuration: 5.0, driftChance: 0.6, driftSpeedScale: 1.08, droneChance: 0.65, dualDroneChance: 0.3, droneSpeedScale: 1.08, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'SOLAR GAUNTLET', subtitle: 'Fast decay · Drifting patrols', anchorCount: 9, captureRadiusScale: 0.88, gravityMultiplier: 1.24, decayDuration: 4.3, driftChance: 0.72, driftSpeedScale: 1.12, droneChance: 0.8, dualDroneChance: 0.48, droneSpeedScale: 1.12, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'DEEP ORBIT', subtitle: 'Chapter 1 finale · Full Low Orbit gauntlet', anchorCount: 10, captureRadiusScale: 0.86, gravityMultiplier: 1.35, decayDuration: 4.2, driftChance: 0.75, driftSpeedScale: 1.15, droneChance: 0.88, dualDroneChance: 0.55, droneSpeedScale: 1.15, shardStarRatio: 0.65, minComboForStar: 6 },
];

// Chapter 2 (11-20): REPULSOR FIELD — introduces anti-gravity (-G) repulsor nodes
const CHAPTER_2_SPECS: readonly ChapterSectorSpec[] = [
  { name: 'INVERSION', subtitle: 'Repulsor nodes (-G) push your arc outward', anchorCount: 7, captureRadiusScale: 0.98, gravityMultiplier: 1.05, decayDuration: 6.4, driftChance: 0, droneChance: 0, repulsorChance: 0.72, repulsorStrengthScale: 0.9, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'CURVE BANK', subtitle: 'Ride repulsive fields around hazards', anchorCount: 8, captureRadiusScale: 0.96, gravityMultiplier: 1.12, decayDuration: 6.0, driftChance: 0, droneChance: 0.25, repulsorChance: 0.82, repulsorStrengthScale: 1.0, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'PHASE DRIFT', subtitle: 'Repulsors paired with lateral anchor drift', anchorCount: 8, captureRadiusScale: 0.94, gravityMultiplier: 1.1, decayDuration: 5.7, driftChance: 0.55, droneChance: 0.25, repulsorChance: 0.78, repulsorStrengthScale: 1.05, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'CROSSWIND', subtitle: 'Stronger -G wells · Compensate your aim', anchorCount: 8, captureRadiusScale: 0.93, gravityMultiplier: 1.2, decayDuration: 5.5, driftChance: 0.35, droneChance: 0.55, repulsorChance: 0.85, repulsorStrengthScale: 1.18, shardStarRatio: 0.6, minComboForStar: 4 },
  { name: 'FLUX CORRIDOR', subtitle: 'Dense repulsor lane · Avoid the coral core', anchorCount: 9, captureRadiusScale: 0.91, gravityMultiplier: 1.15, decayDuration: 5.3, driftChance: 0.45, droneChance: 0.45, repulsorChance: 0.92, repulsorStrengthScale: 1.15, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'POLARITY', subtitle: 'High-G attractors vs strong -G repulsors', anchorCount: 9, captureRadiusScale: 0.9, gravityMultiplier: 1.44, decayDuration: 5.2, driftChance: 0.4, droneChance: 0.5, dualDroneChance: 0.2, repulsorChance: 0.85, repulsorStrengthScale: 1.25, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'DEFLECTOR BELT', subtitle: 'Tight decay under active repulsor shear', anchorCount: 9, captureRadiusScale: 0.89, gravityMultiplier: 1.2, decayDuration: 4.5, driftChance: 0.55, driftSpeedScale: 1.05, droneChance: 0.6, repulsorChance: 0.82, repulsorStrengthScale: 1.2, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'SENTRY WELLS', subtitle: 'Twin drones guarding repulsor alleys', anchorCount: 9, captureRadiusScale: 0.88, gravityMultiplier: 1.18, decayDuration: 4.8, driftChance: 0.5, droneChance: 0.78, dualDroneChance: 0.45, droneSpeedScale: 1.08, repulsorChance: 0.8, repulsorStrengthScale: 1.18, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'MAGNETIC SHEAR', subtitle: 'Narrow rings · High shear repulsors', anchorCount: 10, captureRadiusScale: 0.85, gravityMultiplier: 1.26, decayDuration: 4.4, driftChance: 0.65, driftSpeedScale: 1.1, droneChance: 0.7, dualDroneChance: 0.35, repulsorChance: 0.88, repulsorStrengthScale: 1.28, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'ANTIPODE', subtitle: 'Chapter 2 finale · Master the -G field', anchorCount: 10, captureRadiusScale: 0.86, gravityMultiplier: 1.38, decayDuration: 4.3, driftChance: 0.7, driftSpeedScale: 1.12, droneChance: 0.8, dualDroneChance: 0.48, droneSpeedScale: 1.12, repulsorChance: 0.92, repulsorStrengthScale: 1.32, shardStarRatio: 0.65, minComboForStar: 6 },
];

// Chapter 3 (21-30): AEGIS ARRAY — introduces rotating coral Shield Arcs
const CHAPTER_3_SPECS: readonly ChapterSectorSpec[] = [
  { name: 'SHIELD GATE', subtitle: 'Rotating coral shields · Enter through the cyan gap', anchorCount: 7, captureRadiusScale: 0.98, gravityMultiplier: 1.05, decayDuration: 6.4, driftChance: 0, droneChance: 0, shieldChance: 0.72, shieldSpeedScale: 0.85, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'WINDOW TIMING', subtitle: 'Watch the preview bounce · Wait for the opening', anchorCount: 8, captureRadiusScale: 0.96, gravityMultiplier: 1.1, decayDuration: 5.9, driftChance: 0, droneChance: 0.25, shieldChance: 0.84, shieldSpeedScale: 0.95, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'DEFLECTION', subtitle: 'Shielded orbits with lateral drift', anchorCount: 8, captureRadiusScale: 0.94, gravityMultiplier: 1.12, decayDuration: 5.6, driftChance: 0.55, droneChance: 0.2, shieldChance: 0.8, shieldSpeedScale: 1.0, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'BASTION', subtitle: 'Shielded anchors backed by patrol drones', anchorCount: 8, captureRadiusScale: 0.92, gravityMultiplier: 1.14, decayDuration: 5.4, driftChance: 0.3, droneChance: 0.55, shieldChance: 0.78, shieldSpeedScale: 1.05, shardStarRatio: 0.6, minComboForStar: 4 },
  { name: 'RICOCHET ARC', subtitle: 'Repulsors bending paths into rotating shields', anchorCount: 9, captureRadiusScale: 0.91, gravityMultiplier: 1.16, decayDuration: 5.2, driftChance: 0.35, droneChance: 0.3, repulsorChance: 0.6, shieldChance: 0.82, shieldSpeedScale: 1.05, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'CLOCKWORK', subtitle: 'Faster shield rotation · Tight rhythm', anchorCount: 9, captureRadiusScale: 0.9, gravityMultiplier: 1.22, decayDuration: 4.8, driftChance: 0.45, droneChance: 0.5, shieldChance: 0.9, shieldSpeedScale: 1.2, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'CITADEL DRIFT', subtitle: 'Drifting shields & dual sentinels', anchorCount: 9, captureRadiusScale: 0.88, gravityMultiplier: 1.18, decayDuration: 4.7, driftChance: 0.65, driftSpeedScale: 1.08, droneChance: 0.65, dualDroneChance: 0.35, shieldChance: 0.82, shieldSpeedScale: 1.15, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'GRAVITY LOCK', subtitle: 'High-G bends into narrow shield apertures', anchorCount: 9, captureRadiusScale: 0.86, gravityMultiplier: 1.45, decayDuration: 4.6, driftChance: 0.45, droneChance: 0.55, repulsorChance: 0.45, shieldChance: 0.85, shieldSpeedScale: 1.18, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'IRON CURTAIN', subtitle: 'Fast decay · Heavy shield perimeter', anchorCount: 10, captureRadiusScale: 0.86, gravityMultiplier: 1.25, decayDuration: 4.2, driftChance: 0.6, driftSpeedScale: 1.1, droneChance: 0.7, dualDroneChance: 0.4, shieldChance: 0.9, shieldSpeedScale: 1.24, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'AEGIS CORE', subtitle: 'Chapter 3 finale · Breach the shielded array', anchorCount: 10, captureRadiusScale: 0.85, gravityMultiplier: 1.32, decayDuration: 4.2, driftChance: 0.68, driftSpeedScale: 1.12, droneChance: 0.75, dualDroneChance: 0.45, droneSpeedScale: 1.12, repulsorChance: 0.55, shieldChance: 0.92, shieldSpeedScale: 1.26, shardStarRatio: 0.65, minComboForStar: 6 },
];

// Chapter 4 (31-40): OVERDRIVE RELAY — introduces Boost Anchors & wide-gap leaps
const CHAPTER_4_SPECS: readonly ChapterSectorSpec[] = [
  { name: 'IGNITION', subtitle: 'Boost anchors (×1.3) launch across wide gaps', anchorCount: 7, captureRadiusScale: 0.98, gravityMultiplier: 1.06, decayDuration: 6.2, driftChance: 0, droneChance: 0, boostChance: 0.65, boostMultiplier: 1.32, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'SLINGSHOT GAP', subtitle: 'Chain overdrive leaps through shard trails', anchorCount: 8, captureRadiusScale: 0.95, gravityMultiplier: 1.12, decayDuration: 5.8, driftChance: 0.25, droneChance: 0.3, boostChance: 0.75, boostMultiplier: 1.34, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'AFTERBURNER', subtitle: 'Fast boost climbs with drifting targets', anchorCount: 8, captureRadiusScale: 0.93, gravityMultiplier: 1.15, decayDuration: 5.4, driftChance: 0.6, driftSpeedScale: 1.05, droneChance: 0.35, boostChance: 0.7, boostMultiplier: 1.35, shardStarRatio: 0.55, minComboForStar: 4 },
  { name: 'VECTOR JUMP', subtitle: 'Boost leaps curving past -G repulsors', anchorCount: 8, captureRadiusScale: 0.92, gravityMultiplier: 1.16, decayDuration: 5.2, driftChance: 0.4, droneChance: 0.4, repulsorChance: 0.65, repulsorStrengthScale: 1.1, boostChance: 0.72, boostMultiplier: 1.35, shardStarRatio: 0.6, minComboForStar: 4 },
  { name: 'HYPER BREACH', subtitle: 'Overdrive launches into rotating shield gaps', anchorCount: 9, captureRadiusScale: 0.9, gravityMultiplier: 1.18, decayDuration: 5.0, driftChance: 0.35, droneChance: 0.45, shieldChance: 0.62, shieldSpeedScale: 1.05, boostChance: 0.7, boostMultiplier: 1.36, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'VELOCITY RUN', subtitle: 'Tight decay · High-speed relay chain', anchorCount: 9, captureRadiusScale: 0.89, gravityMultiplier: 1.22, decayDuration: 4.4, driftChance: 0.55, driftSpeedScale: 1.08, droneChance: 0.6, dualDroneChance: 0.3, boostChance: 0.78, boostMultiplier: 1.38, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'GRAV CATAPULT', subtitle: 'High-G + Overdrive extreme arc bends', anchorCount: 9, captureRadiusScale: 0.88, gravityMultiplier: 1.48, decayDuration: 4.7, driftChance: 0.5, droneChance: 0.55, repulsorChance: 0.55, boostChance: 0.72, boostMultiplier: 1.36, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'NEEDLE THREAD', subtitle: 'Narrow landing zones after wide boost jumps', anchorCount: 9, captureRadiusScale: 0.84, gravityMultiplier: 1.24, decayDuration: 4.5, driftChance: 0.6, driftSpeedScale: 1.1, droneChance: 0.68, dualDroneChance: 0.38, shieldChance: 0.5, boostChance: 0.7, boostMultiplier: 1.36, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'REDLINE', subtitle: 'Rapid decay · Overdrive through heavy patrols', anchorCount: 10, captureRadiusScale: 0.85, gravityMultiplier: 1.28, decayDuration: 4.1, driftChance: 0.68, driftSpeedScale: 1.14, droneChance: 0.78, dualDroneChance: 0.48, droneSpeedScale: 1.14, repulsorChance: 0.5, boostChance: 0.75, boostMultiplier: 1.38, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'STARSHOT', subtitle: 'Chapter 4 finale · Maximum overdrive relay', anchorCount: 10, captureRadiusScale: 0.85, gravityMultiplier: 1.36, decayDuration: 4.1, driftChance: 0.72, driftSpeedScale: 1.15, droneChance: 0.82, dualDroneChance: 0.5, droneSpeedScale: 1.15, repulsorChance: 0.62, shieldChance: 0.6, shieldSpeedScale: 1.18, boostChance: 0.8, boostMultiplier: 1.4, shardStarRatio: 0.65, minComboForStar: 6 },
];

// Chapter 5 (41-50): EVENT HORIZON — Mastery Remix combining all orbital systems
const CHAPTER_5_SPECS: readonly ChapterSectorSpec[] = [
  { name: 'CONVERGENCE', subtitle: 'Repulsors, shields & boost relays online', anchorCount: 9, captureRadiusScale: 0.89, gravityMultiplier: 1.22, decayDuration: 4.8, driftChance: 0.55, droneChance: 0.6, dualDroneChance: 0.25, repulsorChance: 0.62, shieldChance: 0.58, boostChance: 0.55, boostMultiplier: 1.34, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'VOID CORRIDOR', subtitle: 'Narrow rings through shifting -G fields', anchorCount: 9, captureRadiusScale: 0.85, gravityMultiplier: 1.28, decayDuration: 4.6, driftChance: 0.65, driftSpeedScale: 1.1, droneChance: 0.65, dualDroneChance: 0.35, repulsorChance: 0.78, repulsorStrengthScale: 1.22, shieldChance: 0.52, boostChance: 0.5, boostMultiplier: 1.35, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'PHALANX', subtitle: 'Shielded sentinels & twin patrol rings', anchorCount: 10, captureRadiusScale: 0.86, gravityMultiplier: 1.25, decayDuration: 4.5, driftChance: 0.6, driftSpeedScale: 1.1, droneChance: 0.82, dualDroneChance: 0.52, droneSpeedScale: 1.14, repulsorChance: 0.5, shieldChance: 0.78, shieldSpeedScale: 1.2, boostChance: 0.55, boostMultiplier: 1.36, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'SLINGSTORM', subtitle: 'High-speed boost chains under fast decay', anchorCount: 10, captureRadiusScale: 0.86, gravityMultiplier: 1.32, decayDuration: 4.1, driftChance: 0.68, driftSpeedScale: 1.14, droneChance: 0.72, dualDroneChance: 0.42, repulsorChance: 0.65, shieldChance: 0.6, boostChance: 0.75, boostMultiplier: 1.38, shardStarRatio: 0.6, minComboForStar: 5 },
  { name: 'SINGULARITY', subtitle: 'Extreme gravity wells & strong repulsors', anchorCount: 10, captureRadiusScale: 0.85, gravityMultiplier: 1.54, decayDuration: 4.3, driftChance: 0.62, driftSpeedScale: 1.12, droneChance: 0.74, dualDroneChance: 0.45, repulsorChance: 0.82, repulsorStrengthScale: 1.32, shieldChance: 0.65, shieldSpeedScale: 1.18, boostChance: 0.58, boostMultiplier: 1.36, shardStarRatio: 0.6, minComboForStar: 6 },
  { name: 'APEX DRIFT', subtitle: 'Fast drifting anchors · Razor timing', anchorCount: 10, captureRadiusScale: 0.84, gravityMultiplier: 1.3, decayDuration: 4.0, driftChance: 0.82, driftSpeedScale: 1.2, droneChance: 0.78, dualDroneChance: 0.48, droneSpeedScale: 1.16, repulsorChance: 0.65, shieldChance: 0.72, shieldSpeedScale: 1.22, boostChance: 0.62, boostMultiplier: 1.38, shardStarRatio: 0.62, minComboForStar: 6 },
  { name: 'IRON HORIZON', subtitle: 'Dense shields, repulsors & twin drones', anchorCount: 11, captureRadiusScale: 0.84, gravityMultiplier: 1.34, decayDuration: 4.0, driftChance: 0.72, driftSpeedScale: 1.16, droneChance: 0.84, dualDroneChance: 0.55, droneSpeedScale: 1.18, repulsorChance: 0.76, repulsorStrengthScale: 1.28, shieldChance: 0.82, shieldSpeedScale: 1.25, boostChance: 0.65, boostMultiplier: 1.38, shardStarRatio: 0.62, minComboForStar: 6 },
  { name: 'CRITICAL MASS', subtitle: 'Sub-4s decay · Zero hesitation climb', anchorCount: 11, captureRadiusScale: 0.84, gravityMultiplier: 1.4, decayDuration: 3.85, driftChance: 0.75, driftSpeedScale: 1.18, droneChance: 0.84, dualDroneChance: 0.55, droneSpeedScale: 1.18, repulsorChance: 0.75, repulsorStrengthScale: 1.3, shieldChance: 0.78, shieldSpeedScale: 1.24, boostChance: 0.7, boostMultiplier: 1.4, shardStarRatio: 0.62, minComboForStar: 6 },
  { name: 'ZERO MARGIN', subtitle: 'Penultimate sector · Precision telemetry mastery', anchorCount: 11, captureRadiusScale: 0.82, gravityMultiplier: 1.42, decayDuration: 3.85, driftChance: 0.78, driftSpeedScale: 1.2, droneChance: 0.86, dualDroneChance: 0.58, droneSpeedScale: 1.2, repulsorChance: 0.8, repulsorStrengthScale: 1.32, shieldChance: 0.84, shieldSpeedScale: 1.28, boostChance: 0.72, boostMultiplier: 1.4, shardStarRatio: 0.65, minComboForStar: 6 },
  { name: 'EVENT HORIZON', subtitle: 'Sector 50 finale · Ultimate orbital extraction', anchorCount: 12, captureRadiusScale: 0.82, gravityMultiplier: 1.45, decayDuration: 3.8, driftChance: 0.8, driftSpeedScale: 1.22, droneChance: 0.9, dualDroneChance: 0.6, droneSpeedScale: 1.22, repulsorChance: 0.85, repulsorStrengthScale: 1.35, shieldChance: 0.86, shieldSpeedScale: 1.3, boostChance: 0.75, boostMultiplier: 1.42, shardStarRatio: 0.65, minComboForStar: 7 },
];

export const ADVENTURE_SECTORS: readonly SectorDefinition[] = [
  ...buildChapterSectors(1, 1, CHAPTER_1_SPECS),
  ...buildChapterSectors(2, 11, CHAPTER_2_SPECS),
  ...buildChapterSectors(3, 21, CHAPTER_3_SPECS),
  ...buildChapterSectors(4, 31, CHAPTER_4_SPECS),
  ...buildChapterSectors(5, 41, CHAPTER_5_SPECS),
];

export function getSectorById(id: number): SectorDefinition {
  const clamped = Math.max(1, Math.min(ADVENTURE_SECTORS.length, Math.floor(id)));
  return ADVENTURE_SECTORS[clamped - 1];
}

export function getChapterById(chapterId: number): ChapterDefinition {
  const clamped = Math.max(1, Math.min(ADVENTURE_CHAPTERS.length, Math.floor(chapterId)));
  return ADVENTURE_CHAPTERS[clamped - 1];
}

export function getSectorsByChapter(chapterId: number): SectorDefinition[] {
  const chapter = getChapterById(chapterId);
  return ADVENTURE_SECTORS.filter((s) => s.chapterId === chapter.id);
}

export function getChapterStarCounts(
  chapterId: number,
  progress: Record<number, SectorProgress>
): { earned: number; max: number } {
  const sectors = getSectorsByChapter(chapterId);
  let earned = 0;
  for (const sector of sectors) {
    earned += progress[sector.id]?.stars ?? 0;
  }
  return { earned, max: sectors.length * 3 };
}

export function loadAdventureProgress(): Record<number, SectorProgress> {
  const result: Record<number, SectorProgress> = {};
  try {
    if (typeof localStorage === 'undefined') return result;
    const raw = localStorage.getItem(ADVENTURE_PROGRESS_STORAGE_KEY);
    if (!raw) return result;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return result;

    const record = parsed as Record<string, unknown>;
    for (const sector of ADVENTURE_SECTORS) {
      const entry = record[String(sector.id)];
      if (!entry || typeof entry !== 'object') continue;
      const obj = entry as Record<string, unknown>;
      const cleared = Boolean(obj.cleared);
      const stars =
        typeof obj.stars === 'number' && Number.isFinite(obj.stars)
          ? Math.max(0, Math.min(3, Math.floor(obj.stars)))
          : 0;
      const bestScore =
        typeof obj.bestScore === 'number' && Number.isFinite(obj.bestScore) && obj.bestScore > 0
          ? Math.floor(obj.bestScore)
          : 0;
      if (cleared || stars > 0 || bestScore > 0) {
        result[sector.id] = { cleared, stars, bestScore };
      }
    }
  } catch {
    // Ignore malformed storage or privacy mode restrictions
  }
  return result;
}

export function saveAdventureProgress(progress: Record<number, SectorProgress>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(ADVENTURE_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Ignore storage quota / privacy mode restrictions
  }
}

export function getHighestUnlockedSectorId(progress: Record<number, SectorProgress>): number {
  let unlocked = 1;
  for (const sector of ADVENTURE_SECTORS) {
    if (progress[sector.id]?.cleared && sector.id < ADVENTURE_SECTORS.length) {
      unlocked = Math.max(unlocked, sector.id + 1);
    }
  }
  return unlocked;
}

export function getTotalAdventureStars(progress: Record<number, SectorProgress>): number {
  let total = 0;
  for (const sector of ADVENTURE_SECTORS) {
    total += progress[sector.id]?.stars ?? 0;
  }
  return total;
}

export function getTotalMaxAdventureStars(): number {
  return ADVENTURE_SECTORS.length * 3;
}
