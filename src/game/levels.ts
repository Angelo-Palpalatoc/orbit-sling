import type { SectorDefinition, SectorProgress } from './types';

const ADVENTURE_PROGRESS_STORAGE_KEY = 'orbit-sling-adventure-v1';

export const ADVENTURE_SECTORS: readonly SectorDefinition[] = [
  {
    id: 1,
    code: '01',
    name: 'CALIBRATION',
    subtitle: 'Stable orbits · Learn the slingshot arc',
    seed: 'sector-01-calibration-v1',
    anchorCount: 6,
    captureRadiusScale: 1.06,
    gravityMultiplier: 1.0,
    decayDuration: 0,
    driftChance: 0,
    driftSpeedScale: 1.0,
    droneChance: 0,
    dualDroneChance: 0,
    droneSpeedScale: 1.0,
    shardStarRatio: 0.5,
    minComboForStar: 3,
  },
  {
    id: 2,
    code: '02',
    name: 'GRAVITY BEND',
    subtitle: 'Stronger pull · Curve shots through shards',
    seed: 'sector-02-gravity-bend-v1',
    anchorCount: 7,
    captureRadiusScale: 1.0,
    gravityMultiplier: 1.24,
    decayDuration: 7.4,
    driftChance: 0,
    driftSpeedScale: 1.0,
    droneChance: 0,
    dualDroneChance: 0,
    droneSpeedScale: 1.0,
    shardStarRatio: 0.55,
    minComboForStar: 3,
  },
  {
    id: 3,
    code: '03',
    name: 'DECAY RUSH',
    subtitle: 'Unstable anchors · Keep moving upward',
    seed: 'sector-03-decay-rush-v1',
    anchorCount: 7,
    captureRadiusScale: 0.98,
    gravityMultiplier: 1.08,
    decayDuration: 4.9,
    driftChance: 0,
    driftSpeedScale: 1.0,
    droneChance: 0,
    dualDroneChance: 0,
    droneSpeedScale: 1.0,
    shardStarRatio: 0.55,
    minComboForStar: 4,
  },
  {
    id: 4,
    code: '04',
    name: 'PATROL RING',
    subtitle: 'Hazard drones · Time your entry window',
    seed: 'sector-04-patrol-ring-v1',
    anchorCount: 8,
    captureRadiusScale: 0.96,
    gravityMultiplier: 1.05,
    decayDuration: 6.0,
    driftChance: 0,
    driftSpeedScale: 1.0,
    droneChance: 0.72,
    dualDroneChance: 0,
    droneSpeedScale: 0.95,
    shardStarRatio: 0.55,
    minComboForStar: 4,
  },
  {
    id: 5,
    code: '05',
    name: 'DRIFTING ORBIT',
    subtitle: 'Lateral drift · Lead moving anchors',
    seed: 'sector-05-drifting-orbit-v1',
    anchorCount: 8,
    captureRadiusScale: 0.95,
    gravityMultiplier: 1.08,
    decayDuration: 5.8,
    driftChance: 0.72,
    driftSpeedScale: 0.95,
    droneChance: 0.35,
    dualDroneChance: 0,
    droneSpeedScale: 1.0,
    shardStarRatio: 0.55,
    minComboForStar: 4,
  },
  {
    id: 6,
    code: '06',
    name: 'TWIN SENTINELS',
    subtitle: 'Dual patrol drones · Thread the gap',
    seed: 'sector-06-twin-sentinels-v1',
    anchorCount: 8,
    captureRadiusScale: 0.93,
    gravityMultiplier: 1.1,
    decayDuration: 5.5,
    driftChance: 0.25,
    driftSpeedScale: 1.0,
    droneChance: 0.85,
    dualDroneChance: 0.55,
    droneSpeedScale: 1.02,
    shardStarRatio: 0.6,
    minComboForStar: 4,
  },
  {
    id: 7,
    code: '07',
    name: 'HIGH-G WELLS',
    subtitle: 'Heavy gravity · Master curved slingshots',
    seed: 'sector-07-high-g-wells-v1',
    anchorCount: 9,
    captureRadiusScale: 0.92,
    gravityMultiplier: 1.52,
    decayDuration: 5.4,
    driftChance: 0.4,
    driftSpeedScale: 1.0,
    droneChance: 0.55,
    dualDroneChance: 0.2,
    droneSpeedScale: 1.05,
    shardStarRatio: 0.6,
    minComboForStar: 5,
  },
  {
    id: 8,
    code: '08',
    name: 'NARROW CORRIDOR',
    subtitle: 'Tight capture rings · Precision launches',
    seed: 'sector-08-narrow-corridor-v1',
    anchorCount: 9,
    captureRadiusScale: 0.85,
    gravityMultiplier: 1.16,
    decayDuration: 5.0,
    driftChance: 0.6,
    driftSpeedScale: 1.08,
    droneChance: 0.65,
    dualDroneChance: 0.3,
    droneSpeedScale: 1.08,
    shardStarRatio: 0.6,
    minComboForStar: 5,
  },
  {
    id: 9,
    code: '09',
    name: 'SOLAR GAUNTLET',
    subtitle: 'Fast decay · Drifting patrols',
    seed: 'sector-09-solar-gauntlet-v1',
    anchorCount: 9,
    captureRadiusScale: 0.88,
    gravityMultiplier: 1.24,
    decayDuration: 4.3,
    driftChance: 0.72,
    driftSpeedScale: 1.12,
    droneChance: 0.8,
    dualDroneChance: 0.48,
    droneSpeedScale: 1.12,
    shardStarRatio: 0.6,
    minComboForStar: 5,
  },
  {
    id: 10,
    code: '10',
    name: 'DEEP ORBIT',
    subtitle: 'Final extraction · All telemetry systems live',
    seed: 'sector-10-deep-orbit-v1',
    anchorCount: 10,
    captureRadiusScale: 0.86,
    gravityMultiplier: 1.35,
    decayDuration: 4.2,
    driftChance: 0.75,
    driftSpeedScale: 1.15,
    droneChance: 0.88,
    dualDroneChance: 0.55,
    droneSpeedScale: 1.15,
    shardStarRatio: 0.65,
    minComboForStar: 6,
  },
] as const;

export function getSectorById(id: number): SectorDefinition {
  const clamped = Math.max(1, Math.min(ADVENTURE_SECTORS.length, Math.floor(id)));
  return ADVENTURE_SECTORS[clamped - 1];
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

