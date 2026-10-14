/* Camera: a few presets round the hand, plus orbit and zoom that ease back on reset.
 * The state lives with the renderer (maybe in a worker); bindOrbit turns page gestures into orbit messages. */
import { type V3, add, sub, len } from "../core/vec";
import type { View } from "./render";

const PRESETS: Record<string, [V3, V3]> = {        // [eye offset, target offset] from the hand centre
  across: [[0.05, 0.14, 0.30], [0.02, -0.06, -0.01]],
  spinner: [[-0.10, -0.23, 0.20], [0, 0.0, -0.01]],
  side: [[-0.33, 0.31, 0.25], [0.0, -0.01, 0.0]],
  top: [[0.0, -0.02, 0.36], [0, 0.01, -0.01]],
};
export const CAMERAS = Object.keys(PRESETS);
export type CamMsg = { t: "orbit"; dx: number; dy: number } | { t: "zoom"; f: number } | { t: "reset" };

export function createCamera(onMoved: (moved: boolean) => void) {
  let preset = "across", yaw = 0, pitch = 0, zoom = 1, tYaw = 0, tPitch = 0, tZoom = 1, moved = false, lift = 0;
  const setMoved = (m: boolean) => { if (m !== moved) { moved = m; onMoved(m); } };
  const reset = () => { tYaw = 0; tPitch = 0; tZoom = 1; setMoved(false); };
  return {
    input(m: CamMsg) {
      if (m.t === "orbit") { tYaw -= m.dx * 0.006; tPitch = Math.max(-0.9, Math.min(0.6, tPitch + m.dy * 0.005)); setMoved(true); }
      else if (m.t === "zoom") { tZoom = Math.max(0.35, Math.min(2.5, tZoom * m.f)); setMoved(true); }
      else reset();
    },
    set(p: string) { if (PRESETS[p]) preset = p; reset(); },
    /** The view for this frame. penZ lifts the camera to follow a pen thrown up; dt in seconds. */
    view(hc: V3, penZ: number, wristZ: number, dt: number, aspect: number, shiftY: number): View {
      const k = 1 - Math.exp(-dt / 0.09), portrait = aspect < 1;
      yaw += (tYaw - yaw) * k; pitch += (tPitch - pitch) * k; zoom += (tZoom - zoom) * k;
      const want = Math.max(0, penZ - (wristZ + 0.04)) * 0.6;
      lift += (want - lift) * (1 - Math.exp(-dt / (want > lift ? 0.08 : 0.25)));
      const [eo, lo] = PRESETS[preset]!, look = add(hc, lo), off = sub(add(hc, eo), look);
      const dist = len(off) * zoom * (portrait ? 1.15 : 1);
      // orbit the preset's offset: yaw about z, pitch towards / away from the top
      const az = Math.atan2(off[1], off[0]) + yaw, el = Math.max(0.12, Math.min(1.45, Math.atan2(off[2], Math.hypot(off[0], off[1])) + pitch));
      const eye: V3 = [look[0] + Math.cos(az) * Math.cos(el) * dist, look[1] + Math.sin(az) * Math.cos(el) * dist, look[2] + Math.sin(el) * dist + lift];
      // portrait: a fixed horizontal field of view (the hand's width fits); landscape: a wider vertical one
      return { eye, look: [look[0], look[1], look[2] + lift], fov: portrait ? Math.min(1.4, 2 * Math.atan(Math.tan(0.4) / aspect)) : 0.95, shiftY: portrait ? shiftY : 0 };
    },
  };
}

/** Drag = orbit, pinch / wheel = zoom, double tap = back to the preset. */
export function bindOrbit(el: HTMLElement, send: (m: CamMsg) => void) {
  const pts = new Map<number, { x: number; y: number }>();
  let pinch = 0, tapT = 0;
  const gap = () => { const [a, b] = [...pts.values()]; return Math.hypot(a!.x - b!.x, a!.y - b!.y); };
  el.addEventListener("pointerdown", (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    el.setPointerCapture(e.pointerId);
    if (pts.size === 2) pinch = gap();
    if (e.timeStamp - tapT < 300) send({ t: "reset" });
    tapT = e.timeStamp;
  });
  el.addEventListener("pointermove", (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) send({ t: "orbit", dx, dy });
    else if (pts.size === 2 && pinch) { const d = gap(); send({ t: "zoom", f: pinch / d }); pinch = d; }
  });
  const up = (e: PointerEvent) => { pts.delete(e.pointerId); pinch = 0; };
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
  el.addEventListener("wheel", (e) => { e.preventDefault(); send({ t: "zoom", f: Math.exp(e.deltaY * 0.001) }); }, { passive: false });
}
