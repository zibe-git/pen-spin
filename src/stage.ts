/* The 3D stage: hand simulation (IK, contacts, pen physics) + camera + renderer, driven by messages.
 * It runs in a Web Worker on an OffscreenCanvas when the browser can, so none of its work ever blocks a tap;
 * otherwise in the page, through the same messages. The page sends the game clock and a snapshot of the combo,
 * and the stage works out where the pen is from those on its own. */
import type { Slot } from "./core/tricks";
import { BYID, type PenState } from "./core/tricks";
import * as hand from "./sim/hand";
import { createRenderer } from "./gfx/render";
import { type CamMsg, createCamera } from "./gfx/camera";

/** What the stage needs to know about the combo (sent whenever it changes). */
export interface Snap {
  state: "idle" | "spin" | "drop"; slot: Slot;
  cur: { id: string; from: Slot; to: Slot; t0: number; dur: number; catchAt: number; landed: boolean } | null;
  next: { id: string; dur: number } | null;
}
export type ToStage =
  | { t: "init"; canvas: HTMLCanvasElement | OffscreenCanvas; w: number; h: number; dpr: number; origin: number; pen: string; side: number; camera: string }
  | { t: "size"; w: number; h: number; dpr: number }
  | { t: "clock"; base: number; perfBase: number; rate: number }
  | { t: "combo"; snap: Snap }
  | { t: "glide" } | { t: "pen"; c: string } | { t: "side"; side: number } | { t: "cam"; preset: string } | { t: "shift"; v: number }
  | CamMsg;
export type FromStage = { t: "ready" } | { t: "moved"; v: boolean } | { t: "fail"; msg: string };

/** Where the pen should be at game time `now`, from the combo snapshot (also asked a little ahead). */
export function penState(s: Snap, now: number): PenState {
  if (s.state === "drop") return { kind: "drop" };
  const c = s.cur;
  if (s.state === "spin" && c) {
    if (now < c.catchAt) return { kind: "spin", trick: BYID[c.id]!, from: c.from, u: (now - c.t0) / c.dur };
    if (s.next && !c.landed) return { kind: "spin", trick: BYID[s.next.id]!, from: c.to, u: (now - c.catchAt) / s.next.dur };
    return { kind: "hold", slot: c.to };
  }
  return { kind: "hold", slot: s.slot };
}

export function createStage(post: (m: FromStage) => void) {
  let r: ReturnType<typeof createRenderer> = null;
  const cam = createCamera((v) => post({ t: "moved", v }));
  let snap: Snap = { state: "idle", slot: "12", cur: null, next: null };
  let clk = { base: 0, perfBase: 0, rate: 1 }, skew = 0, side = 1, w = 1, h = 1, dpr = 1, pen = "#e8453c", shift = 0.1, shiftNow = 0.1, last = 0, running = false;
  const raf: (cb: (t: number) => void) => void = typeof requestAnimationFrame === "function" ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(() => cb(performance.now()), 16);
  const clock = () => clk.base + (performance.now() + skew - clk.perfBase) * clk.rate;

  function frame(t: number) {
    raf(frame);
    if (!r) return;
    const dt = Math.min(0.05, Math.max(0, (t - (last || t)) / 1000));
    last = t;
    const now = clock(), f = hand.step(now, dt * clk.rate, (at) => penState(snap, at));
    shiftNow += (shift - shiftNow) * (1 - Math.exp(-dt / 0.25));
    r.draw(f, cam.view(hand.handCenter(), f.pen.c[2], f.wristZ, dt, w / h, shiftNow), side, t, dt);
  }

  return {
    async handle(m: ToStage) {
      switch (m.t) {
        case "init": {
          skew = m.origin ? performance.timeOrigin - m.origin : 0;   // the page's clock, seen from a worker
          side = m.side; w = m.w; h = m.h; dpr = m.dpr; pen = m.pen;
          cam.set(m.camera);
          const rr = createRenderer(m.canvas);
          if (!rr) return post({ t: "fail", msg: "3D needs WebGL 2: the timing game still works" });
          hand.getGeo();                              // solve the rig while the shaders compile
          await rr.ready;
          rr.resize(w, h, dpr);                       // the latest size and pen (they may have changed meanwhile)
          rr.setPen(pen);
          r = rr;
          if (!running) { running = true; raf(frame); }
          return post({ t: "ready" });
        }
        case "size": w = m.w; h = m.h; dpr = m.dpr; return r?.resize(w, h, dpr);
        case "clock": clk = m; return;
        case "combo": snap = m.snap; return;
        case "glide": return hand.glide();
        case "pen": pen = m.c; return r?.setPen(pen);
        case "side": side = m.side; return cam.input({ t: "reset" });
        case "cam": return cam.set(m.preset);
        case "shift": shift = m.v; return;
        default: return cam.input(m);
      }
    },
  };
}
