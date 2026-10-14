# Pen Spin

Real pen spinning tricks on a 3D hand. Tap on the catch to link the next trick.
The whole game is one 27 KB (brotli) HTML file: no engine, no images, no fonts.
See [PLAN.md](PLAN.md) for how it compares to the earlier prototypes, and for what to build next.

```sh
bun install
bun run dev        # http://localhost:4173, rebuilds on save
bun run build      # dist/: index.html (+ .br/.gz), sw.js, manifest, icon. Prints the size table.
bun test           # every path of every trick (start, landing, no jumps), combos, timing engine, minifier
bun run typecheck
bun run shots      # phone-sized screenshots of every screen and camera, played through the real UI
bun run report     # Lighthouse mobile + desktop + a played user flow (INP). Writes reports/vitals.md
```

`shots` and `report` use a local Chrome or Edge, or the one in `CHROME_PATH`.

## How it's built

| | |
|---|---|
| `src/core/` | Pure game logic: the trick catalog and pen motion (`tricks.ts`), the timing engine (`combo.ts`), the real combos (`combos.ts`), vector maths |
| `src/sim/hand.ts` | The hand: finger chains from anatomical data, damped-least-squares IK, fingers that lift out of the pen's way, rod-vs-capsule contact, and the dropped pen bouncing on the desk |
| `src/gfx/` | WebGL2: one instanced capsule mesh for the hand and pen, a procedural desk, motion trails, and analytic capsule shadows. The camera lives here too |
| `src/stage.ts` | The 3D stage. It runs in a **Web Worker on an OffscreenCanvas**, so the IK and rendering never block a tap (in-page fallback without it). It gets the game clock and a combo snapshot, and animates the pen itself |
| `src/main.ts` | The game: modes, HUD, menus, progression, saves, sound. The same bundle starts as the stage when it finds itself in a worker |
| `scripts/build.ts` | `Bun.build` with minification, plus a GLSL minifier plugin. Inlines JS and CSS into the HTML, then pre-compresses with brotli and gzip |

How the build keeps the vitals good:

- **First paint.** The page is one request with inline CSS. The title is HTML text and is the LCP element. The system font stack means no webfont downloads.
- **Startup.** The 3D starts after the first paint. Shaders compile in parallel when the driver supports `KHR_parallel_shader_compile`. The rig is solved on first use, in the worker.
- **Taps stay fast.** The tap handler does only the timing. Audio set-up and the first-run dialog wait until after the next paint. Frames never rewrite unchanged text. The timing bar animates with transforms only, and the HUD and dock use CSS containment.
- **Lighthouse note.** Headless Lighthouse renders WebGL in software (SwiftShader), so 3D timings there are worst-case.

## Credits

The trick mechanics and combo breakdowns come from the pen spinning community:

- [Wikipedia: Pen spinning](https://en.wikipedia.org/wiki/Pen_spinning)
- [Pen Spinning Trick Directory](https://sites.google.com/site/penspinningtrickdirectory/home/tricks)
- [penspinningcentral.com: beginner combos](https://penspinningcentral.com/beginner-penspinning-combos/)
- [chrisjet98: basic combos](http://chrisjet98.blogspot.com/2015/05/tutorial-basic-combos.html)
- [vonguru: BanZ World Tour 2007 breakdown](https://vonguru.fr/2015/03/08/dossier-le-penspinning-technique-23/)
- [penstock.net: beginner combo](https://penstock.net/database/post/beginner-combo-in-pen-spinning-3)
- [penspinning.org: beginner videos](https://www.penspinning.org/beginners-videos)
- [r/penspinning](https://www.reddit.com/r/penspinning/) (Kam's 4 Loop)
- [kidactivities.net: trick steps](https://kidactivities.net/?p=6047), [Instructables: Thumbaround](https://instructables.com/Pen-Spinning:--Thumbaround), [pentricks: master list of moves](https://pentricks.wordpress.com/how-to-do-pen-tricks-pen-spinning-tutorials/master-list-of-pen-spinning-moves/)

The Trick Book links to tutorial videos on YouTube. They are not part of this repository and belong to their creators:
Pen Stock, shoeman6, JohnnyBarko, AdR0KaT, KTrinh93 and Jayesh Kukreti.

The hand's dimensions come from *Radiological analysis of finger length ratio and dimensional profile of finger anatomy morphology*
([J Musculoskeletal Surgery and Research, 2024](https://journalmsr.com/radiological-analysis-of-finger-length-ratio-and-dimensional-profile-of-finger-anatomy-morphology/)).
Its range of motion follows the AAOS norms. The segment-to-segment distance follows Christer Ericson's *Real-Time Collision Detection*.

## License

[MIT](LICENSE) for the code in this repository.
