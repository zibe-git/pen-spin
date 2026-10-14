# Pen Spin: comparison and game plan

## The three earlier apps

| | `3d-pen-spin` (desktop + `mobile-first-pen-spin`) | `pen-spin-web` | `pen-spinner-mobile` |
|---|---|---|---|
| What it is | The original: a combo-timing game. A desktop pywebview app with a seated MakeHuman body, plus a "Lite" phone PWA | A static GitHub Pages copy of the desktop app (same code) | A different idea: a trick **viewer / tutorial**, not a game |
| Renderer | Babylon.js 9 (desktop), Three.js r170 (Lite) | Babylon.js 9 | Babylon.js 9 |
| Hand | Skinned 48k-vertex body + IK (desktop); capsules + IK (Lite) | Skinned body + IK | Skinned MakeHuman hand, dual-quaternion skinning, offline pose tuner |
| Tricks | 117 (76 verified), 18 real combos, slot model | same | 5 |
| Gameplay | Flow / Endless / Combos / Free play, Study mode, demo bot | same | Watch, scrub, slow-mo; combo builder |
| Download | ~15 MB (desktop), ~228 KB gz (Lite) | ~25 MB on disk, ~15 MB transferred | ~9.8 MB (~2.7 MB gz) |
| Weak spots | Two hand-copied cores; no progression; keyboard-first desktop UI | Same as desktop, heavy on phones | Its own clearance check fails 4 of 5 tricks; not a game |

**Kept:** the framework-free core from `3d-pen-spin` is the best part of all three: the trick catalog with real
pivots and push/friction speed profiles, the slot model that makes combos physically connected, the Cabal-style
timing engine, the 18 sourced combos, and the Lite capsule hand with IK, contact and drop physics.
**Dropped:** Babylon and Three.js (1.8 MB and 171 KB gzipped), the MakeHuman body and its 12 MB of textures,
approximate tricks, and back-of-hand tricks that the timing modes could never reach.

## This game

A finished, phone-first web game in **27 KB brotli, one request**.

- **Core loop.** A single button with Cabal-style timing. Tap in the window to link the next trick; gold is PERFECT and raises the multiplier.
- **Flow.** *When* you tap (early, perfect or late) picks which connected trick comes next. The perfect pick is a real linkage from the documented combos.
- **Endless.** Pure timing: the game picks the next trick.
- **Combo Ladder.** 16 real combos, easiest first. Landing one unlocks the next, and PERFECT links earn up to 3 stars.
- **Trick Book.** 74 verified tricks fill in as you land them. Each one has how-to steps and a tutorial video link.
- **Pens.** 7 colourways unlock at milestones: landed tricks, streaks, stars, tricks learned.
- **Feel.**
  - Synth sound effects and haptics.
  - Popups, a catch wobble, and motion trails on fast spins.
  - The pen falls onto the desk and bounces when you drop it.
  - The menu has an attract mode where the game plays itself.
  - A first-run how-to, a pause menu, and a practice slow-mo.
- **Fairness.** Taps are timed by the event's own timestamp, and a tap-along calibration sets the latency offset.
- **Accessibility and reach.**
  - Left-hand mirroring, a portrait and a landscape layout, and keyboard play (Space / Enter / Esc).
  - Reduced motion support and an offline PWA.
- **3D.** A hand-written WebGL2 renderer in a Web Worker on an OffscreenCanvas, with an in-page fallback.
  - About 23 instanced capsules on a procedural desk.
  - Analytic soft shadows and occlusion, ACES tone mapping.
  - Adaptive resolution and context-loss recovery.

## Next steps (in order of value)

1. **Play-test the timing on real phones.** The window sizes and points were carried over and have never been tuned against players.
2. **Daily challenge.** A seeded Flow run, so everyone gets the same trick sequence that day. Local only, no server needed.
3. **Bring back Study mode.** Slow-motion loop and scrub for any trick from the Trick Book. The data (`howTo`, `videoFor`) is already shipped.
4. **More tricks from the old catalog.** Back-of-hand and aerial moves. These need the knuckle-valley code from the desktop app and a way into those slots (Knuckle Up).
5. **Tune grips per trick.** The desktop sweep showed 20 of 160 paths sink 3–5 mm into the skin. Port `sweep()` as a test.
