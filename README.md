# Orbit Sling

A minimalist 60fps orbital slingshot arcade game built with TypeScript, HTML5 Canvas 2D, and zero-asset procedural Web Audio.

Drag anywhere to pull back, watch gravity bend your live trajectory preview through nearby orbital anchors, and chain clean captures as orbits decay, anchors drift, and hazard drones patrol higher sectors.

## Core Mechanics

- **Orbital Slingshot:** Your probe circles each captured anchor. Pull back anywhere on screen to aim and release to sling along a physics-simulated flight path.
- **Live Gravity Trajectory Preview:** Aiming engages subtle slow-motion and predicts the exact curved gravity trajectory using the same fixed-timestep integrator as live flight—highlighting locked anchor captures and drone collision warnings.
- **Decay Tension:** Higher-altitude anchors begin decaying the moment you enter orbit. Plan your next launch before the ring collapses.
- **Combo Multiplier & Anchor Skips:** Chain consecutive new-anchor captures to build your combo multiplier (`x2`, `x3`, …) and skip past intermediate anchors for bonus points.
- **Energy Shards:** Curve your flight path through floating shards between orbits for extra score.
- **Progressive Difficulty:** As you climb, anchors introduce lateral drift, tighter decay timers, and orbiting hazard drones.

## Controls

| Input | Action |
| --- | --- |
| **Mouse Drag** (anywhere) | Pull back to aim & preview trajectory, release to launch |
| **Touch Drag** (anywhere) | Pull back to aim, lift finger to launch |
| **Tap outside card** (Game Over) | Quick restart |
| **`R`** | Instant restart |
| **`M`** | Toggle sound mute (persisted in `localStorage`) |
| **`Space` / `Enter`** (Game Over) | Quick restart |
| **`Esc`** | Cancel active aim |

## Tech Stack

- **TypeScript 5** (`strict` mode, fixed-timestep simulation, zero runtime dependencies)
- **Vite 6** (fast dev server and production bundling)
- **HTML5 Canvas 2D** (DPR-aware rendering, parallax starfield, particle/shockwave feedback, camera damping & hit-stop)
- **Web Audio API** (100% procedural sound synthesis—pentatonic capture chimes, filtered launch whoosh, shard bells, telemetry sonar ticks, and crash bursts with zero external audio files)

## Local Development

```bash
npm install
npm run dev
```

Additional scripts:

```bash
npm run typecheck   # Strict TypeScript check (tsc --noEmit)
npm run build       # Typecheck + production bundle to dist/
npm run preview     # Preview production build locally
```

## Deployment

### Vercel

Zero-config deployment:

1. Import this repository in Vercel.
2. Vercel auto-detects the **Vite** framework preset (`npm run build`, output directory `dist`).
3. Deploy.

### GitHub Pages

`vite.config.ts` already sets `base: './'`, so the compiled `dist/` directory works out of the box from any subpath (including `https://<username>.github.io/<repo>/`).

1. Run `npm run build`.
2. Publish the `dist/` folder via GitHub Actions (`actions/deploy-pages`) or your preferred Pages workflow.

---

Built by [Angelo Palpalatoc](https://angelo-palpalatoc.vercel.app/) · [GitHub](https://github.com/Angelo-Palpalatoc)
