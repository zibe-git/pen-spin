/* The spinning hand: anatomy, finger chains, IK, contact and pen physics (ported from the 3d-pen-spin Lite app,
 * renderer-free). The hand is made of capsules, which are both what is drawn and the colliders.
 *
 * Hand-local frame (anatomy): wrist at origin, fingers +Y, back of hand +Z, thumb at -X. World: z up, metres.
 */
import { type V3, type M3, D2R, X, Y, Z, add, sub, mul, dot, cross, len, norm, lerp, rot, mat3, mv, mm, segSeg, smooth } from "../core/vec";
import { type Finger, type Geo, type PenState, type Pivot, type Pose, type Slot, GAP, SLOTS, contacts, fingerOffsets, isFree, makeGeometry, penAt, resolve, slotPose, wrist } from "../core/tricks";

// ------------------------------------------------- anatomy (mm, degrees) ----
// Sources: radiological finger bone study (J Musculoskeletal Surgery and Research 2024, 384 adults), AAOS range of motion.
const SOFT = [6.5, 6.0, 5.0], PAD = 4;
const AN = {
  index: { base: [-0.030, 0.088, 0.000] as V3, splay: 6, L: [39.18, 21.34, 15.30], w: [[15.64, 10.72], [11.98, 8.86], [8.89, 6.8]], rest: [45, 40, 5] },
  middle: { base: [-0.009, 0.092, 0.000] as V3, splay: 0, L: [43.63, 25.80, 16.23], w: [[15.16, 11.26], [12.89, 9.59], [9.59, 7.2]], rest: [45, 55, 20] },
  ring: { base: [0.012, 0.088, -0.001] as V3, splay: -5, L: [40.97, 24.49, 16.64], w: [[14.06, 10.50], [11.84, 9.13], [9.14, 6.9]], rest: [50, 65, 49] },
  pinky: { base: [0.031, 0.079, -0.003] as V3, splay: -12, L: [31.85, 17.05, 14.88], w: [[13.18, 8.95], [9.58, 7.71], [7.52, 5.8]], rest: [55, 65, 37] },
};
const THUMB = { base: [-0.024, 0.028, -0.016] as V3, goal: [-0.044, 0.100, -0.060] as V3, rest: [-25, 30, 40], L: [46.0, 29.79, 20.85], w: [[26.0, 21.0], [14.13, 10.78], [10.78, 8.4]] };
const ROM = { mcp: [-20, 90], abd: 20, pip: [0, 100], dip: [-10, 70], cmc: 60, tmcp: 60, tip: 80 };

// ------------------------------------------------------- rig constants ----
const HAND_ROT = [0, 40, 10], HAND_LIFT = 0.006;
export const PEN_R = 0.0052, PEN_HALF = 0.092;   // a long, balanced "mod" pen
const SPIN_ROLL = -24;                           // the hand rolls palm-down compared with writing (deg)
const WRIST_UP: V3 = [0.025, -0.02, 0.065];
const POSES: Record<string, Record<string, number[]>> = {   // finger flex (MCP, PIP, DIP) in degrees
  post: { index: [14, 22, 10], middle: [12, 22, 10], ring: [16, 26, 12], pinky: [22, 30, 14] },
  lift: { index: [-14, 6, 2], middle: [-14, 6, 2], ring: [-12, 8, 4], pinky: [-10, 10, 6] },
  curl: { index: [55, 70, 35], middle: [55, 70, 35], ring: [60, 75, 40], pinky: [62, 75, 40] },
};
const BETA = 0.48;                               // grip tilt: the pinky-side end sits above the finger plane
const FINGERS = ["index", "middle", "ring", "pinky"] as const;
const DIGITS: Finger[] = ["thumb", ...FINGERS];
const R = (v: V3) => rot(Z, HAND_ROT[2]! * D2R, rot(Y, HAND_ROT[1]! * D2R, rot(X, HAND_ROT[0]! * D2R, v)));
const RT = (v: V3) => rot(X, -HAND_ROT[0]! * D2R, rot(Y, -HAND_ROT[1]! * D2R, rot(Z, -HAND_ROT[2]! * D2R, v)));
const RM = mat3(R);

interface Chain { pts: V3[]; hinge: V3 }
interface IK { base: V3; dirs: V3[]; L: number[]; hinge: V3; yaw: V3[]; theta: number[]; free: number[]; w: number[]; lo: number[]; hi: number[] }
interface Cap { a: V3; b: V3; r: number; f: Finger | "palm"; i: number }

const segR = (w: number[][]) => w.map(([a, b], i) => [(a! + SOFT[i]!) / 2000, (b! + SOFT[i]!) / 2000] as [number, number]);
const SEG_R = {} as Record<Finger, [number, number][]>, COLL = {} as Record<Finger, number[]>, chains = {} as Record<Finger, Chain>;
const rest = {} as Record<Finger, number[]>;
for (const n of FINGERS) {
  const f = AN[n], L = f.L.map((v) => v / 1000); L[2]! += PAD / 1000;
  SEG_R[n] = segR(f.w); rest[n] = f.rest;
  const rz = (v: V3) => rot(Z, f.splay * D2R, v), pts = [f.base];
  let pitch = 0;
  L.forEach((l, i) => { pitch += f.rest[i]!; pts.push(add(pts[i]!, mul(rz(rot(X, -pitch * D2R, Y)), l))); });
  chains[n] = { pts, hinge: rz(X) };
}
{
  const L = THUMB.L.map((v) => v / 1000); L[2]! += PAD / 1000;
  SEG_R.thumb = segR(THUMB.w);
  const d = norm(sub(THUMB.goal, THUMB.base)), hinge = norm(cross(d, norm([1, 0, -0.3]))), pts = [THUMB.base];
  let ang = 0;
  L.forEach((l, i) => { ang += THUMB.rest[i]!; pts.push(add(pts[i]!, mul(rot(hinge, ang * D2R, d), l))); });
  chains.thumb = { pts, hinge };
}
for (const n of DIGITS) COLL[n] = SEG_R[n].map(([a, b]) => Math.max(a, b));
const OFFSET: V3 = (() => {
  const WEB: V3 = [-0.056, 0.060, 0.022];
  const centroid = mul(add(add(chains.index.pts[3]!, chains.middle.pts[3]!), chains.thumb.pts[3]!), 1 / 3);
  return add(mul(R(add(centroid, mul(norm(sub(centroid, WEB)), 0.026))), -1), [0, 0, HAND_LIFT]);
})();
const PALM: Cap[] = FINGERS.map((n) => { const b = chains[n].pts[0]!; return { a: [b[0] * 0.7, 0.03, b[2] + 0.002], b, r: 0.013, f: "palm", i: 0 }; });

// --------------------------------------------------------------------- IK ----
function makeChain(n: Finger): IK {
  const c = chains[n], dirs: V3[] = [], L: number[] = [];
  for (let i = 0; i < 3; i++) { const v = sub(c.pts[i + 1]!, c.pts[i]!); L.push(len(v)); dirs.push(norm(v)); }
  const ch: IK = { base: c.pts[0]!, dirs, L, hinge: c.hinge, yaw: dirs.map((d) => norm(cross(c.hinge, d))), theta: [0, 0, 0, 0, 0, 0], free: [], w: [], lo: [], hi: [] };
  const joints: { a: number[]; b?: number[]; wa?: number; wb?: number }[] = n === "thumb"
    ? [{ a: [-ROM.cmc, ROM.cmc], b: [-ROM.cmc, ROM.cmc], wa: 1.25, wb: 1.25 }, { a: [-ROM.tmcp, ROM.tmcp], b: [-ROM.tmcp, ROM.tmcp] }, { a: [-ROM.tip, ROM.tip], b: [-ROM.tip, ROM.tip] }]
    : [ROM.mcp, ROM.pip, ROM.dip].map((range, i) => {
      const lim = [rest[n][i]! - range[1]!, rest[n][i]! - range[0]!];
      return i ? { a: lim } : { a: lim, b: [-ROM.abd, ROM.abd], wb: 2.5 };
    });
  joints.forEach((j, i) => {
    for (const [k, spec, wt] of [[2 * i, j.a, j.wa || 1], [2 * i + 1, j.b, j.wb || 1]] as const) {
      if (!spec) continue;
      ch.free.push(k); ch.w.push(wt); ch.lo.push(spec[0]! * D2R); ch.hi.push(spec[1]! * D2R);
    }
  });
  return ch;
}
function fk(ch: IK, th: number[]): V3[] {
  const pts = [ch.base];
  let q = (v: V3) => v;
  for (let i = 0; i < 3; i++) {
    const a = th[2 * i]!, b = th[2 * i + 1]!, h = ch.hinge, z = ch.yaw[i]!, prev = q;
    q = (v) => prev(rot(z, b, rot(h, a, v)));
    pts.push(add(pts[i]!, mul(q(ch.dirs[i]!), ch.L[i]!)));
  }
  return pts;
}
type Eff = number | { b: number; t: number };
const effOf = (pts: V3[], ef: Eff) => (typeof ef === "object" ? lerp(pts[ef.b]!, pts[ef.b + 1]!, ef.t) : ef === 1 ? pts[3]! : lerp(pts[2]!, pts[3]!, ef));
/** Damped least squares with joint limits; ef = effector along the chain. */
function dls(ch: IK, target: V3, iters: number, ef: Eff = 1) {
  const th = ch.theta, n = ch.free.length;
  for (let it = 0; it < iters; it++) {
    const tip = effOf(fk(ch, th), ef), e = sub(target, tip);
    if (len(e) < 1.5e-5) break;
    const J = ch.free.map((k) => { const o = th[k]!; th[k] = o + 1e-4; const p = effOf(fk(ch, th), ef); th[k] = o; return mul(sub(p, tip), 1e4); });
    const A = [[1e-5, 0, 0], [0, 1e-5, 0], [0, 0, 1e-5]];
    for (let c = 0; c < n; c++) for (let r = 0; r < 3; r++) for (let s = 0; s < 3; s++) A[r]![s]! += J[c]![r]! * J[c]![s]! / ch.w[c]!;
    const x = solve3(A, e);
    for (let c = 0; c < n; c++) { const k = ch.free[c]!; th[k] = Math.min(ch.hi[c]!, Math.max(ch.lo[c]!, th[k]! + dot(J[c]!, x) / ch.w[c]!)); }
  }
  return fk(ch, th);
}
function solve3(A: number[][], b: V3): V3 {
  const [a, d, g] = [A[0]![0]!, A[1]![0]!, A[2]![0]!], [bb, e, h] = [A[0]![1]!, A[1]![1]!, A[2]![1]!], [c, f, i] = [A[0]![2]!, A[1]![2]!, A[2]![2]!];
  const det = a * (e * i - f * h) - bb * (d * i - f * g) + c * (d * h - e * g) || 1e-12;
  return [
    (b[0] * (e * i - f * h) - bb * (b[1] * i - f * b[2]) + c * (b[1] * h - e * b[2])) / det,
    (a * (b[1] * i - f * b[2]) - b[0] * (d * i - f * g) + c * (d * b[2] - b[1] * g)) / det,
    (a * (e * b[2] - b[1] * h) - bb * (d * b[2] - b[1] * g) + b[0] * (d * h - e * g)) / det,
  ];
}
function solveIK(ch: IK, target: V3) {
  const reach = 0.997 * (ch.L[0]! + ch.L[1]! + ch.L[2]!), off = sub(target, ch.base);
  if (len(off) > reach) target = add(ch.base, mul(norm(off), reach));
  ch.theta.fill(0);
  dls(ch, target, 300);
  return ch.theta.slice();
}

// --------------------------------------------------------- spin set-up ----
const CH = {} as Record<Finger, IK>, TH = { post: {}, lift: {}, curl: {} } as Record<"post" | "lift" | "curl", Record<Finger, number[]>>;
const flexTheta = (n: (typeof FINGERS)[number], f: number[]) => [(rest[n][0]! - f[0]!) * D2R, 0, (rest[n][1]! - f[1]!) * D2R, 0, (rest[n][2]! - f[2]!) * D2R, 0];
let geo: Geo | null = null;
/** The hand's spinning geometry (finger pivots, gaps, grip). Solved on first use, not at import. */
export const getGeo = (): Geo => geo || (geo = setup());
function setup(): Geo {
  for (const n of DIGITS) CH[n] = makeChain(n);
  const pivots = {} as Record<Finger, Pivot>;
  for (const n of FINGERS) {
    TH.post[n] = flexTheta(n, POSES.post![n]!); TH.lift[n] = flexTheta(n, POSES.lift![n]!); TH.curl[n] = flexTheta(n, POSES.curl![n]!);
    const p = fk(CH[n], TH.post[n]);              // a finger's pivot: the middle of its middle bone
    pivots[n] = { p: lerp(p[1]!, p[2]!, 0.5), f: norm(sub(p[2]!, p[1]!)), r: COLL[n][1]! };
  }
  const ix = pivots.index.p;                      // thumb pad against the side of the index's middle bone
  TH.post.thumb = solveIK(CH.thumb, [ix[0] - 0.017, ix[1] - 0.008, ix[2] - 0.006]);
  const tg = fk(CH.thumb, TH.post.thumb);
  pivots.thumb = { p: lerp(tg[2]!, tg[3]!, 0.45), f: norm(sub(tg[3]!, tg[2]!)), r: COLL.thumb[2]! };
  TH.lift.thumb = solveIK(CH.thumb, [tg[3]![0] - 0.012, tg[3]![1] - 0.022, tg[3]![2] + 0.03]);
  TH.curl.thumb = solveIK(CH.thumb, [tg[3]![0] + 0.02, tg[3]![1] - 0.025, tg[3]![2] - 0.012]);
  const across = norm([pivots.pinky.p[0] - pivots.index.p[0], pivots.pinky.p[1] - pivots.index.p[1], 0]);
  const grip = norm(add(mul(across, Math.cos(BETA)), mul(Z, Math.sin(BETA))));
  const pinch = {} as Record<Slot, V3>;
  for (const g of SLOTS) { const [fa, fb] = GAP[g]; pinch[g] = lerp(pivots[fa].p, pivots[fb].p, 0.5); }
  const down = mv(mat3((v) => rot(Y, -SPIN_ROLL * D2R, RT(v))), [0, 0, -1]);   // gravity in hand space
  for (const n of DIGITS) { lift[n] = 0; cur[n] = TH.post[n].slice(); }
  return makeGeometry(pivots, pinch, grip, down);
}

// ------------------------------------------------------------- contacts ----
const penEnds = (p: Pose): [V3, V3] => [add(p.c, mul(p.u, -(PEN_HALF - PEN_R))), add(p.c, mul(p.u, PEN_HALF - PEN_R))];
const digitCaps = (n: Finger, pts: V3[]): Cap[] => [0, 1, 2].map((i) => ({ a: pts[i]!, b: pts[i + 1]!, r: COLL[n][i]!, f: n, i }));
function clearance(caps: Cap[], pens: Pose[]) {
  let m = Infinity;
  for (const p of pens) { const [a, b] = penEnds(p); for (const c of caps) m = Math.min(m, segSeg(a, b, c.a, c.b).d - PEN_R - c.r); }
  return m;
}
/** Push the pen (a rigid rod) out of the capsules: it slides and tilts away from each contact. */
function pushPenOut(pen: Pose, caps: Cap[], iters = 4): Pose {
  let { c, u } = pen;
  for (let it = 0; it < iters; it++) {
    let moved = false;
    for (const cap of caps) {
      const [a, b] = penEnds({ c, u }), q = segSeg(a, b, cap.a, cap.b), depth = PEN_R + cap.r - q.d;
      if (depth <= 1e-5) continue;
      const n = q.d > 1e-9 ? mul(sub(q.c1, q.c2), 1 / q.d) : [0, 0, -1] as V3, off = dot(sub(q.c1, c), u);
      if (Math.abs(off) < 0.015) c = add(c, mul(n, depth));
      else { c = add(c, mul(n, depth * 0.5)); u = norm(add(u, mul(sub(n, mul(u, dot(n, u))), depth * 0.5 / off))); }
      moved = true;
    }
    if (!moved) break;
  }
  const moved = sub(c, pen.c), m = len(moved);   // never shove the pen more than 2 cm in one go
  if (m > 0.02) c = add(pen.c, mul(moved, 0.02 / m));
  return { c, u };
}
const LIFTS = [0, 0.15, -0.15, 0.3, -0.3, 0.5, -0.5, 0.75, -0.75, 1, -1, 1.5, -1.5];   // + lift up, - tuck in
const ORDER: Record<Finger, number> = { thumb: -1, index: 0, middle: 1, ring: 2, pinky: 3 };
/** Where a free finger rests in a grip: pinky side of the gap tucks in, thumb side lifts a little. */
function slotBias(n: Finger, slot: Slot) {
  if (n === "thumb") return 0;
  const [a, b] = GAP[slot];
  return ORDER[n] > ORDER[b] ? -0.65 : ORDER[n] < ORDER[a] ? 0.25 : 0;
}
function gripBias(n: Finger, st: PenState) {
  if (st.kind === "hold") return slotBias(n, st.slot);
  if (st.kind !== "spin") return 0;
  const r = resolve(st.trick, st.from, st.u), w = smooth(Math.min(1, Math.max(0, (r.u - 0.3) / 0.6)));
  return slotBias(n, r.from) * (1 - w) + slotBias(n, r.to) * w;
}
const thetaAt = (n: Finger, h: number) => TH.post[n].map((a, i) => a + ((h >= 0 ? TH.lift[n][i]! : TH.curl[n][i]!) - a) * Math.abs(h));
const thick = (c: Cap): Cap => ({ ...c, r: c.f === "palm" ? 0.0155 : c.r + 0.0012 });

// ---------------------------------------------------------------- state ----
const lift = {} as Record<Finger, number>, cur = {} as Record<Finger, number[]>;
let settle: { t: number; dir: number } | null = null, rollCur = 0, prevKind = "hold";
let prevTrickDir = 1;
let fly: { c: V3; u: V3; v: V3; w: V3 } | null = null, pickup: { from: Pose; t: number } | null = null;
let lastWorld: Pose | null = null, prevPen: (Pose & { dt: number }) | null = null, lastWasDrop = false;

function penLocal(st: PenState, now: number): Pose {
  const geo = getGeo();
  if (st.kind === "spin") return penAt(st.trick, st.from, geo, st.u);
  let w = 0;
  if (settle && now >= settle.t) {                // caught: overshoot and settle like a real pen
    const t = (now - settle.t) / 1000;
    w = settle.dir * 0.16 * Math.exp(-t / 0.07) * Math.sin(2 * Math.PI * t / 0.12);
  }
  return slotPose(st.kind === "hold" ? st.slot : "12", geo, w);
}

/** What one frame of the hand looks like, in world space. */
export interface Bone { a: V3; b: V3; r0: number; r1: number }
export interface Frame { bones: Bone[]; palm: { c: V3; x: V3; y: V3; z: V3 }; fore: Bone; pen: Pose; wristZ: number }

/** Advance the hand to game time `now` (ms). `source(t)` says where the pen should be at time t. */
export function step(now: number, dt: number, source: (t: number) => PenState): Frame {
  getGeo();
  const st = source(now);
  if (st.kind === "hold" && prevKind === "spin") settle = { t: now, dir: prevTrickDir };
  prevKind = st.kind;
  if (st.kind === "spin") prevTrickDir = st.trick.dir;
  const k = (tau: number) => 1 - Math.exp(-dt / tau);
  const inHand = st.kind !== "drop" && !pickup;
  const wr = inHand ? wrist(st) : { roll: 0, yaw: 0, lift: 0 };
  rollCur += (wr.roll - rollCur) * k(0.06);
  const bob = Math.sin(now / 900) * 0.0015;
  const Bm: M3 = mm(RM, mat3((v) => rot(Z, wr.yaw, rot(Y, (SPIN_ROLL - rollCur) * D2R, v))));
  const W = add(add(OFFSET, WRIST_UP), [0, 0, bob + wr.lift]);
  const toWorld = (p: V3) => add(W, mv(Bm, p));

  // 1. where the trick wants the pen now, and a little later (so fingers get out of the way in time)
  let pen = inHand ? penLocal(st, now) : null;
  const ahead = pen ? [pen, ...[25, 50, 80].map((ms) => source(now + ms)).filter((s) => s.kind !== "drop").map((s) => penLocal(s, now))] : [];
  const keep = new Set(inHand ? contacts(st) : []);
  const air = st.kind === "spin" && (() => { const r = resolve(st.trick, st.from, st.u); return r.seg.kind === "wiper" || isFree(r); })();

  // 2. free digits: lift (or tuck) just enough that the pen passes them
  const joints = {} as Record<Finger, V3[]>, offs = inHand ? fingerOffsets(st) : {};
  for (const n of DIGITS) {
    if (keep.has(n)) continue;
    let target = 0.55;                            // pen dropped or being picked up: relaxed, open
    if (inHand) {
      const restH = gripBias(n, st);
      let bestC = -Infinity;
      target = restH;
      for (const dh of LIFTS) {
        const h = Math.max(-1, Math.min(1, restH + dh)), cl = clearance(digitCaps(n, fk(CH[n], thetaAt(n, h))), ahead);
        if (cl > 0.0015) { target = h; break; }
        if (cl > bestC + 0.0005) { bestC = cl; target = h; }
      }
    }
    lift[n] += (target - lift[n]) * k(Math.abs(target) > Math.abs(lift[n]) ? 0.012 : 0.07);
    const th = thetaAt(n, lift[n]), kk = k(0.012);
    if (offs[n]) th[0]! -= offs[n]! * D2R;        // knuckle push / dip for this trick
    for (let i = 0; i < 6; i++) cur[n][i]! += (th[i]! - cur[n][i]!) * kk;
    joints[n] = fk(CH[n], cur[n]);
  }

  // 3. the pen is a solid rod: push it out of the palm, the free fingers and the base of the holding fingers
  let caps: Cap[] | null = null;
  if (pen) {
    caps = [...PALM];
    for (const n of DIGITS) { const dc = digitCaps(n, joints[n] || fk(CH[n], cur[n])); caps.push(...(keep.has(n) ? dc.slice(0, 1) : dc)); }
    pen = air ? pushPenOut(pen, caps.map(thick), 8) : pushPenOut(pen, caps);
  }

  // 4. holding digits: IK the finger pad onto the pen surface where the pen crosses the finger
  const held: Cap[] = [];
  for (const n of keep) {
    const ch = CH[n];
    ch.theta.splice(0, 6, ...cur[n]);
    const p0 = fk(ch, ch.theta), [a, b] = penEnds(pen!), x1 = segSeg(a, b, p0[1]!, p0[2]!), x2 = segSeg(a, b, p0[2]!, p0[3]!);
    const bone = x1.d < x2.d ? 1 : 2, x = bone === 1 ? x1 : x2;
    const ef = { b: bone, t: Math.min(0.85, Math.max(0.2, x.t)) }, e = effOf(p0, ef), q = segSeg(a, b, e, e);
    const side = (v: V3) => sub(v, mul(pen!.u, dot(v, pen!.u)));
    let nrm = side(sub(e, q.c1));
    if (st.kind === "hold" && len(nrm) < PEN_R + COLL[n][bone]! * 0.5) nrm = side(sub(p0[0]!, q.c1));
    dls(ch, add(q.c1, mul(norm(nrm), PEN_R + COLL[n][bone]! * 0.92)), 20, ef);   // skin squeezes a little
    cur[n] = ch.theta.slice();
    lift[n] = 0;
    joints[n] = fk(ch, cur[n]);
    held.push(...digitCaps(n, joints[n]).map((c) => ({ ...c, r: c.i === bone ? c.r * 0.92 : c.r })));
  }
  if (held.length && caps) pen = pushPenOut(pen!, [...caps, ...held], 6);

  // 5. the pen in the world: in flight, being picked up, or in the fingers
  let penW: Pose;
  if (st.kind === "drop") {
    if (!fly) startFlight();
    stepFlight(dt, joints, toWorld);
    penW = { c: fly!.c, u: fly!.u };
  } else {
    fly = null;
    const pl = pen || penLocal(st, now);
    penW = { c: toWorld(pl.c), u: mv(Bm, pl.u) };
    if (lastWasDrop && lastWorld) pickup = { from: lastWorld, t: 0 };
    if (pickup) {                                 // the hand picks the pen up off the desk
      pickup.t += dt / 0.45;
      const s = smooth(Math.min(1, pickup.t)), c = lerp(pickup.from.c, penW.c, s);
      c[2] += 0.05 * Math.sin(Math.PI * s);
      penW = { c, u: norm(lerp(pickup.from.u, penW.u, s)) };
      if (pickup.t >= 1) pickup = null;
    }
  }
  lastWasDrop = st.kind === "drop";
  prevPen = lastWorld ? { ...lastWorld, dt } : null;
  lastWorld = penW;

  const bones: Bone[] = [];
  for (const n of DIGITS) {
    const w = joints[n]!.map(toWorld);
    for (let i = 0; i < 3; i++) bones.push({ a: w[i]!, b: w[i + 1]!, r0: SEG_R[n][i]![0], r1: SEG_R[n][i]![1] });
  }
  const fa = toWorld([0.0, 0.004, -0.004]), fb = toWorld([0.004, -0.26, -0.03]);
  return { bones, palm: { c: toWorld([0.001, 0.047, -0.004]), x: mv(Bm, X), y: mv(Bm, Y), z: mv(Bm, Z) },
    fore: { a: fb, b: fa, r0: 0.035, r1: 0.027 }, pen: penW, wristZ: W[2] };
}

/** The hand moves the resting pen to another gap (between combos). */
export function glide() { if (lastWorld) pickup = { from: lastWorld, t: 0 }; }

// pen falling onto the desk after a drop
function startFlight() {
  const c0 = lastWorld!;
  let v: V3 = [0, 0, 0], w: V3 = [0, 0, 0];
  if (prevPen && prevPen.dt > 0) { v = mul(sub(c0.c, prevPen.c), 1 / prevPen.dt); w = mul(cross(prevPen.u, c0.u), 1 / prevPen.dt); }
  if (len(v) > 1.5) v = mul(norm(v), 1.5);
  v = add(v, [(Math.random() - 0.5) * 0.3, 0.25, 0.35]);   // flicked off the fingers
  if (len(w) < 6) w = add(w, [0, 0, (Math.random() < 0.5 ? -1 : 1) * 10]);
  fly = { c: c0.c.slice() as V3, u: c0.u.slice() as V3, v, w };
}
function stepFlight(dt: number, joints: Record<Finger, V3[]>, toWorld: (p: V3) => V3) {
  const f = fly!, n = 4, h = dt / n;
  const caps = [...PALM, ...DIGITS.flatMap((d) => digitCaps(d, joints[d]!))].map((c) => ({ ...c, a: toWorld(c.a), b: toWorld(c.b) }));
  for (let i = 0; i < n; i++) {
    for (const cap of caps) {                     // the falling pen bounces off the fingers
      const [a, b] = penEnds(f), q = segSeg(a, b, cap.a, cap.b), depth = PEN_R + cap.r - q.d;
      if (depth <= 0 || q.d < 1e-9) continue;
      const nn = mul(sub(q.c1, q.c2), 1 / q.d), vn = dot(f.v, nn);
      f.c = add(f.c, mul(nn, depth));
      if (vn < 0) f.v = sub(f.v, mul(nn, 1.4 * vn));
      f.w = add(mul(f.w, 0.9), mul(cross(sub(q.c1, f.c), nn), -vn * 40));
    }
    f.v[2] -= 9.81 * h;
    f.c = add(f.c, mul(f.v, h));
    f.u = norm(add(f.u, mul(cross(f.w, f.u), h)));
    const reach = PEN_R + PEN_HALF * Math.abs(f.u[2]);
    if (f.c[2] < reach) {                         // on the desk: bounce, lose spin, settle flat
      f.c[2] = reach;
      if (f.v[2] < 0) f.v[2] *= -0.3;
      f.v[0] *= 0.96; f.v[1] *= 0.96;
      f.w = mul(f.w, 0.93);
      f.u = norm([f.u[0], f.u[1], f.u[2] * 0.8]);
      if (Math.abs(f.v[2]) < 0.05) f.v[2] = 0;
    }
  }
}

/** Centre of the hand in the world (camera presets look at it). */
export const handCenter = () => add(add(OFFSET, WRIST_UP), mv(mm(RM, mat3((v) => rot(Y, SPIN_ROLL * D2R, v))), [-0.012, 0.115, getGeo().zp]));
