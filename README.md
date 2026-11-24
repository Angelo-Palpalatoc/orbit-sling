# Orbit Sling

**[Play Live Demo →](https://orbit-sling-gamma.vercel.app/)**

A minimalist 60fps orbital slingshot arcade game built with TypeScript, HTML5 Canvas 2D, and zero-asset procedural Web Audio.

Drag anywhere to pull back, watch gravity—and anti-gravity—bend your live trajectory preview through orbital anchors, and chain clean captures across **Endless** mode or a **5-Chapter, 50-Sector Adventure Campaign**.

## Core Mechanics

- **Orbital Slingshot:** Your probe circles each captured anchor. Pull back anywhere on screen to aim and release to sling along a physics-simulated flight path.
- **Live Gravity Trajectory Preview:** Aiming engages subtle slow-motion and predicts the exact curved flight path using the same fixed-timestep integrator as live physics—highlighting locked anchor captures, `-G` repulsor bends, shield deflections, and hazard warnings.
- **Decay Tension & Patrol Drones:** Higher-altitude anchors begin decaying the moment you enter orbit, while lateral drift and orbiting hazard drones demand clean timing.
- **Repulsor (`-G`) Wells:** Anti-gravity nodes bend flight arcs outward so you can bank around obstacles—stay clear of their coral cores.
- **Rotating Shield Arcs:** Coral deflector arcs orbit anchor capture rings and bounce off-angle shots; thread the open cyan gap to capture.
- **Overdrive Boost Anchors:** Supercharged gold anchors amplify launch velocity to vault across wide deep-space gaps.
- **Combo Multiplier, Anchor Skips & Energy Shards:** Chain consecutive new-anchor captures to build your combo (`x2`, `x3`, …), skip anchors for bonus points, and curve through floating shards.
- **Adventure Mode (5 Chapters · 50 Sectors & 150-Star Mastery):** Switch between **Endless** and **Adventure** on the start screen (deep-linkable via `?mode=adventure` or `?mode=adventure&sector=14`). Browse all 5 chapters (**01 Low Orbit**, **02 Repulsor Field**, **03 Aegis Array**, **04 Overdrive Relay**, and **05 Event Horizon**—the full-system mastery remix) with the compact chapter pager, reach each sector's Extraction Goal, and collect up to **150 stars** (3 per sector: Extraction Clear, Shard Target, and Max Combo) with progress saved in `localStorage`.
- **Share Sheet & Challenge Links (`?beat=N`):** Open the Share modal from Victory or Game Over to preview and save a 1080×1080 procedural PNG telemetry score card, share directly to Facebook, Instagram (auto-copies challenge link for Story Link Stickers), or X, or copy a visual emoji flight trace + `"Can you beat N?"` challenge link.

## Controls

| Input | Action |
| --- | --- |
| **Mouse Drag** (anywhere) | Pull back to aim & preview trajectory, release to launch |
| **Touch Drag** (anywhere) | Pull back to aim, lift finger to launch |
| **Tap outside card** (Game Over) | Quick restart |
| **`R`** | Instant restart |
| **`M`** | Toggle sound mute (persisted in `localStorage`) |
| **`Space` / `Enter`** (Victory / Game Over) | Next sector/chapter on Victory (Play Endless after Sector 50) / quick restart on Game Over |
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
