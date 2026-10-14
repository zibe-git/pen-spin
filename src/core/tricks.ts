/* Pen spinning tricks: where the pen is (in hand space) at any moment of a trick.
 *
 * Between tricks the pen is pinched in a GAP between the sides of two fingers (Japanese numbering,
 * 1 = thumb ... 5 = pinky), lying across them and tilted so half of it is above the finger plane:
 *
 *     12 = thumb|index   23 = index|middle   34 = middle|ring   45 = ring|pinky
 *
 * A trick is a chain of SEGMENTS (a linkage in pen spinning notation, "Pass > Pass"), each one a real motion:
 *   orbit:  the pen rolls round a finger (or two) as a rigid body; 180 deg = Pass, 360 = Around. The axis leans
 *           towards the finger: a little for Arounds, a lot for Backarounds.
 *   conic:  spins in place between two fingers, the ends tracing a cone (Charge).
 *   hop:    a conic spin while sliding to another gap (Sonic; Shadow: free in the middle, real gravity).
 *   wiper:  held near one end, swings half a turn up over the hand.
 *
 * Speed: a finger push accelerates the pen, friction at the contact slows it (constant torque) until the catch.
 * Only VERIFIED tricks are shipped (mechanics documented in the sources the original catalog cites).
 * Pure maths, no DOM: also run by the tests.
 */
import { type V3, D2R, Z, add, sub, mul, dot, cross, norm, lerp, rot, clamp01, smooth } from "./vec";

export type Slot = "12" | "23" | "34" | "45";
export type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";
export type SlotMap = Partial<Record<Slot, Slot>>;
export type Pose = { c: V3; u: V3 };

export interface Seg {
  kind: "orbit" | "conic" | "hop" | "wiper";
  moves: SlotMap;
  ms: number;
  spin?: number;
  pivot?: Finger | Partial<Record<Slot, Finger>>;
  pair?: [Finger, Finger];
  gamma?: number;
  wob?: number;
  fl?: boolean;
  bump?: Finger;
  free?: boolean;
  swings?: number[];
  push?: string;
}
export interface Trick {
  id: string; name: string; family: string; pts: number; segs: Seg[]; about: string;
  ms: number; moves: SlotMap; dir: number; push: string | null;
}

export const SLOTS: Slot[] = ["12", "23", "34", "45"];
export const GAP: Record<Slot, [Finger, Finger]> = { 12: ["thumb", "index"], 23: ["index", "middle"], 34: ["middle", "ring"], 45: ["ring", "pinky"] };
const WESTERN: Record<Slot, string> = { 12: "T1", 23: "12", 34: "23", 45: "34" };
export const slotLabel = (s: Slot, western = false) => (western ? WESTERN[s] : s);

// ------------------------------------------------------------ slot maps ----
const same = (slots: Slot[]): SlotMap => Object.fromEntries(slots.map((s) => [s, s]));
const DOWN: SlotMap = { 12: "23", 23: "34", 34: "45" }, UP: SlotMap = { 45: "34", 34: "23", 23: "12" };
const PIV_DOWN = { 12: "index", 23: "middle", 34: "ring" } as const, PIV_UP = { 45: "ring", 34: "middle", 23: "index" } as const;
const AROUND: Record<Finger, Slot[]> = { thumb: ["12"], index: ["12", "23"], middle: ["23", "34"], ring: ["34", "45"], pinky: ["45"] };

// ----------------------------------------------------- segment builders ----
type O = Partial<Seg>;
const S = {
  around: (f: Finger, spin: number, o: O = {}): Seg => ({ kind: "orbit", pivot: f, spin, moves: same(AROUND[f]), ms: 260 + Math.abs(spin) * 1.2, ...o }),
  pass: (o: O = {}): Seg => ({ kind: "orbit", pivot: PIV_DOWN, spin: 180, gamma: 0, moves: DOWN, ms: 430, ...o }),
  passR: (o: O = {}): Seg => ({ kind: "orbit", pivot: PIV_UP, spin: -180, gamma: 0, moves: UP, ms: 430, ...o }),
  pair: (f: "index" | "middle" | "ring", spin: number, o: O = {}): Seg =>
    ({ kind: "orbit", pair: ["thumb", f], spin, moves: ({ index: { 23: "23" }, middle: { 34: "34" }, ring: { 45: "45" } } as const)[f], ms: 300 + Math.abs(spin) * 1.3, ...o }),
  bak: (f: Finger, spin: number, o: O = {}): Seg => ({ kind: "orbit", pivot: f, spin, gamma: 1.15, moves: same(AROUND[f]), ms: 300 + Math.abs(spin) * 1.3, ...o }),
  conic: (spin: number, o: O = {}): Seg => ({ kind: "conic", spin, moves: same(SLOTS), ms: 220 + Math.abs(spin) * 1.15, ...o }),
  hop: (spin: number, moves: SlotMap, o: O = {}): Seg => ({ kind: "hop", spin, moves, ms: 240 + Math.abs(spin) * 0.9, ...o }),
  wiper: (swings: number[], o: O = {}): Seg => ({ kind: "wiper", swings, moves: same(SLOTS), ms: 260 + swings.length * 300, ...o }),
};
const wipe = (sw: number[], slots: Slot[]) => S.wiper(sw, { moves: same(slots) });

// ------------------------------------------------------------- catalog ----
export const FAMILIES = ["Arounds", "Backarounds", "Charges", "Sonics", "Passes", "Wipers", "Fakes", "Linkages"] as const;
const [AR, BAK, CH, SO, PA, WI, FAKE, LINK] = FAMILIES;
type Row = [id: string, name: string, family: string, pts: number, segs: Seg[], about: string, push?: string];
const CATALOG: Row[] = [
  ["ta", "ThumbAround", AR, 100, [S.around("thumb", -360, { moves: { 12: "12", 23: "23" } })], "The middle finger pushes it against the thumb; one turn around it", "middle"],
  ["tar", "ThumbAround Rev", AR, 110, [S.around("thumb", 360, { moves: { 12: "12", 23: "23" } })], "ThumbAround the other way", "index"],
  ["ta15", "ThumbAround 1.5", AR, 160, [S.around("thumb", -540, { moves: { 23: "12" } })], "From between index and middle, one and a half turns round the thumb", "middle"],
  ["ta2", "Double ThumbAround", AR, 180, [S.around("thumb", -720)], "Two turns around the thumb", "middle"],
  ["ta2r", "Double TA Rev", AR, 190, [S.around("thumb", 720)], "Two reverse turns around the thumb", "index"],
  ["tah", "ThumbAround Harmonic", AR, 200, [S.around("thumb", -360), S.around("thumb", 360)], "ThumbAround, then straight back in reverse", "middle"],
  ["flta", "Fingerless TA", AR, 140, [S.around("thumb", -360, { fl: true })], "ThumbAround started by a wrist flick, no finger push", "wrist"],
  ["fltar", "Fingerless TA Rev", AR, 150, [S.around("thumb", 360, { fl: true })], "Reverse ThumbAround from a wrist flick", "wrist"],
  ["tia", "ThumbIndexaround", AR, 150, [S.pair("index", -360)], "One turn around the thumb and index together", "middle"],
  ["tma", "ThumbMiddlearound", AR, 170, [S.pair("middle", -360)], "One turn around the thumb and middle finger", "ring"],
  ["tra", "ThumbRingaround", AR, 190, [S.pair("ring", -360)], "One wide turn around the thumb and ring finger", "pinky"],
  ["ia", "Indexaround", AR, 110, [S.around("index", 360)], "One turn around the index finger, pushed once"],
  ["iar", "Indexaround Rev", AR, 120, [S.around("index", -360)], "Reverse turn around the index finger"],
  ["ma", "Middlearound", AR, 120, [S.around("middle", 360)], "One turn around the middle finger"],
  ["mar", "Middlearound Rev", AR, 130, [S.around("middle", -360)], "Reverse turn around the middle finger"],
  ["ra", "Ringaround", AR, 130, [S.around("ring", 360)], "One turn around the ring finger"],
  ["rar", "Ringaround Rev", AR, 140, [S.around("ring", -360)], "Reverse turn around the ring finger"],
  ["pa", "Pinkyaround", AR, 150, [S.around("pinky", 360)], "One turn around the pinky"],
  ["par", "Pinkyaround Rev", AR, 160, [S.around("pinky", -360)], "Reverse turn around the pinky"],
  ["flia", "Fingerless Indexaround", AR, 140, [S.around("index", 360, { fl: true })], "Indexaround from a wrist flick", "wrist"],
  ["flma", "Fingerless Middlearound", AR, 150, [S.around("middle", 360, { fl: true })], "Middlearound from a wrist flick", "wrist"],
  ["flra", "Fingerless Ringaround", AR, 160, [S.around("ring", 360, { fl: true })], "Ringaround from a wrist flick", "wrist"],
  ["neo", "NeoSonic", AR, 150, [S.around("middle", -360, { gamma: 0.45 })], "A slanted, loose reverse Middlearound"],
  ["neor", "NeoSonic Rev", AR, 160, [S.around("middle", 360, { gamma: 0.45 })], "NeoSonic the other way"],
  ["passa", "Passaround", AR, 90, [S.pass({ gamma: 0.45, ms: 470 })], "A Pass flipped loose around the finger"],
  ["passar", "Passaround Rev", AR, 100, [S.passR({ gamma: 0.45, ms: 470 })], "Passaround back towards the thumb"],
  ["cia", "Counter Indexaround", AR, 150, [S.around("index", 360, { wob: -70 })], "Starts the wrong way, then swings around the index"],
  ["bak", "Backaround", BAK, 150, [S.bak("index", 360, { fl: true })], "Over the back of the index, driven by a wrist turn", "wrist"],
  ["bakr", "Backaround Rev", BAK, 160, [S.bak("index", -360, { fl: true })], "Backaround the other way", "wrist"],
  ["mbak", "Middlebackaround", BAK, 170, [S.bak("middle", 360, { fl: true })], "Over the back of the middle finger", "wrist"],
  ["rbak", "Ringbackaround", BAK, 180, [S.bak("ring", 360, { fl: true })], "Over the back of the ring finger", "wrist"],
  ["pbak", "Pinkybackaround", BAK, 190, [S.bak("pinky", 360, { fl: true })], "Over the back of the pinky", "wrist"],
  ["neobak", "NeoBackaround", BAK, 170, [S.bak("index", 360, { moves: { 23: "23" } })], "From 23: the middle finger pushes it over the back of the index", "middle"],
  ["neobakr", "NeoBackaround Rev", BAK, 180, [S.bak("index", -360, { moves: { 23: "23" } })], "NeoBackaround the other way", "middle"],
  ["bust", "Bust", BAK, 180, [S.bak("index", -360, { bump: "middle" })], "Reverse Backaround with an upward bump from the middle finger", "middle"],
  ["kbak", "Korean Backaround", BAK, 170, [S.bak("middle", -360, { gamma: 1.0, fl: true })], "Backaround at the fingertips", "wrist"],
  ["antig", "Anti-gravity", BAK, 160, [S.around("middle", -360, { fl: true, gamma: 0.15 })], "Fingerless reverse around, flat with the palm down", "wrist"],
  ["cbak", "Counter Backaround", BAK, 190, [S.bak("index", 360, { fl: true, wob: -70 })], "Backaround that starts the wrong way", "wrist"],
  ["charge", "Charge", CH, 80, [S.conic(-360)], "Spins in place between two fingers, the ends tracing a cone"],
  ["charger", "Charge Rev", CH, 90, [S.conic(360)], "Charge the other way"],
  ["sonic", "Sonic", SO, 150, [S.hop(-360, UP)], "One conic turn, sliding one gap towards the thumb", "thumb"],
  ["sonicr", "Sonic Rev", SO, 160, [S.hop(360, DOWN)], "One reverse turn, sliding one gap towards the pinky", "index"],
  ["tsonic", "Twisted Sonic", SO, 170, [S.conic(-180, { moves: same(["23", "34", "45"]), ms: 340 }), S.passR()], "Half a Charge, then a Pass"],
  ["tsonicr", "Twisted Sonic Rev", SO, 180, [S.conic(180, { moves: same(["12", "23", "34"]), ms: 340 }), S.pass()], "Half a reverse Charge, then a Pass the other way"],
  ["msonic", "Moonwalk Sonic", SO, 180, [S.hop(360, UP)], "Sonic moving the same way it spins", "thumb"],
  ["msonicr", "Moonwalk Sonic Rev", SO, 190, [S.hop(-360, DOWN)], "Reverse Moonwalk Sonic", "index"],
  ["shadow", "Shadow", SO, 200, [S.hop(-540, UP, { free: true, ms: 700 })], "A Sonic with no finger hold: 1.5 free turns into the next gap", "middle"],
  ["shadowr", "Shadow Rev", SO, 210, [S.hop(540, DOWN, { free: true, ms: 700 })], "Shadow the other way", "index"],
  ["csonic", "Counter Sonic", SO, 180, [S.hop(-360, UP, { wob: 70 })], "Sonic that starts the wrong way", "thumb"],
  ["pass", "Pass", PA, 50, [S.pass()], "Half a turn over one finger, towards the pinky"],
  ["passr", "Pass Rev", PA, 60, [S.passR()], "Half a turn back towards the thumb"],
  ["passu", "Pass (to thumb)", PA, 60, [S.around("index", 180, { pivot: PIV_UP, gamma: 0, moves: UP, ms: 430 })], "A Pass travelling back towards the thumb"],
  ["passrd", "Pass Rev (to pinky)", PA, 60, [S.around("index", -180, { pivot: PIV_DOWN, gamma: 0, moves: DOWN, ms: 430 })], "A reverse Pass travelling towards the pinky"],
  ["fpass", "FingerPass", PA, 300, [S.pass(), S.pass(), S.pass(), S.passR(), S.passR(), S.passR()], "Passes all the way to the pinky and back"],
  ["fpassr", "FingerPass Rev", PA, 300, [S.passR(), S.passR(), S.passR(), S.pass(), S.pass(), S.pass()], "From the pinky up to the thumb and back"],
  ["wiper", "Wiper", WI, 90, [S.wiper([180])], "Held near one end, swings half a turn"],
  ["wiperr", "Wiper Rev", WI, 100, [S.wiper([-180])], "Wiper the other way"],
  ["wiperh", "Wiper Harmonic", WI, 150, [S.wiper([180, -180])], "Wiper and back"],
  ["inf", "Infinity", WI, 220, [wipe([180], ["12", "23", "34"]), S.pass(), wipe([-180], ["23", "34", "45"]), S.passR()], "Wipers and Passes in a figure eight"],
  ["infr", "Infinity Rev", WI, 230, [wipe([-180], ["23", "34", "45"]), S.passR(), wipe([180], ["12", "23", "34"]), S.pass()], "Infinity the other way"],
  ["inf2", "Double Infinity", WI, 320, [wipe([180], ["12", "23", "34"]), S.pass(), wipe([-180], ["23", "34", "45"]), S.passR(),
    wipe([180], ["12", "23", "34"]), S.pass(), wipe([-180], ["23", "34", "45"]), S.passR()], "Two figure eights"],
  ["cta", "Counter ThumbAround", FAKE, 160, [S.around("thumb", -360, { wob: 80 })], "A short swing the wrong way first", "middle"],
  ["halftap", "Halftap", FAKE, 70, [S.around("index", 0, { pivot: PIV_DOWN, moves: same(["12", "23", "34"]), wob: 150, ms: 420 })], "A fake half turn: starts a Pass and taps back"],
  ["sonicrise", "Sonic Rise", LINK, 230, [S.hop(-360, UP), S.hop(-360, UP)], "Two Sonics up the hand", "thumb"],
  ["sonicfall", "Sonic Fall", LINK, 230, [S.hop(360, DOWN), S.hop(360, DOWN)], "Two reverse Sonics down the hand", "index"],
  ["sonicm", "Multiple Sonic", LINK, 300, [S.hop(-360, UP), S.hop(-360, UP), S.hop(-360, UP)], "Three Sonics, pinky side to thumb", "thumb"],
  ["sonich", "Sonic Harmonic", LINK, 230, [S.hop(-360, UP), S.hop(360, DOWN)], "Sonic and straight back", "thumb"],
  ["dcharge", "Double Charge", LINK, 230, [S.conic(-180, { moves: same(["34"]), ms: 340 }), S.passR(), S.pass()], "Twisted Sonic, then a Pass: 34 > 23 > 34"],
  ["demon", "Demon's Sonic", LINK, 230, [S.hop(-360, UP), S.passR()], "A Sonic straight into a reverse Pass", "thumb"],
  ["rfans", "Rising Fans", LINK, 300, [S.conic(-360, { moves: same(["45"]) }), S.hop(-360, UP), S.conic(-360), S.hop(-360, UP), S.conic(-360)], "Charge > Sonic > Charge > Sonic > Charge, up the hand"],
  ["ffans", "Falling Fans", LINK, 300, [S.conic(360, { moves: same(["23"]) }), S.hop(360, DOWN), S.conic(360), S.hop(360, DOWN), S.conic(360)], "Reverse Charges and Sonics, down the hand"],
  ["exta", "Extended ThumbAround", LINK, 210, [S.around("thumb", -360), S.around("index", 360, { moves: { 12: "12" } })], "ThumbAround straight into an Indexaround", "middle"],
  ["tsbust", "Twisted Sonic Bust", LINK, 300, [S.conic(-180, { moves: same(["34"]), ms: 340 }), S.passR(), S.bak("index", -360, { bump: "middle", moves: { 23: "23" } })], "Twisted Sonic, then a Bust: a finisher"],
  ["bakfall", "Backaround Fall", LINK, 420, [S.bak("index", 360, { fl: true }), S.pass(), S.bak("middle", 360, { fl: true }), S.pass(), S.bak("ring", 360, { fl: true }), S.pass(), S.bak("pinky", 360, { fl: true })],
    "A Backaround on every finger, index to pinky, linked with Passes", "wrist"],
];

function composeMoves(segs: Seg[]): SlotMap {
  const moves: SlotMap = {};
  for (const s0 of SLOTS) {
    let s: Slot | undefined = s0;
    for (const sg of segs) { s = sg.moves[s]; if (!s) break; }
    if (s) moves[s0] = s;
  }
  return moves;
}
export const TRICKS: Trick[] = CATALOG.map(([id, name, family, pts, segs, about, push]) => {
  const last = segs[segs.length - 1]!;
  if (push) segs[0]!.push = push;                     // who pushes the pen off (shown by that finger's flick)
  return { id, name, family, pts, segs, about, ms: Math.round(segs.reduce((a, s) => a + s.ms, 0)), moves: composeMoves(segs),
    dir: Math.sign(last.spin || (last.swings ? last.swings[last.swings.length - 1]! : 0) || 1), push: push || null };
}).filter((t) => Object.keys(t.moves).length);
export const BYID: Record<string, Trick> = Object.fromEntries(TRICKS.map((t) => [t.id, t]));

// --------------------------------------------------------------- physics ----
/** Game durations at speed 1 are about twice real time, so 1 game second = TEMPO real seconds. */
export const TEMPO = 0.5, G = 9.81;
const PUSH = 0.12, CATCH_SPEED = 0.35;   // push lasts 12% of a move; friction slows the spin to 35% by the catch
/** Rotation progress 0..1: angular speed rises while a finger pushes (0..a0), is constant while the pen is free
 *  (a0..a1), then falls linearly under friction at the catching fingers to CATCH_SPEED of its top speed. */
function profile(u: number, a0 = PUSH, a1 = PUSH, r = CATCH_SPEED) {
  const th = (x: number) => (x < a0 ? (x * x) / (2 * a0) : x < a1 ? a0 / 2 + (x - a0)
    : a0 / 2 + (a1 - a0) + (x - a1) - ((1 - r) * (x - a1) * (x - a1)) / (2 * (1 - a1)));
  return th(u) / th(1);
}

// -------------------------------------------------------------- geometry ----
export interface Pivot { p: V3; f: V3; r: number }
export interface Geo { zp: number; gaps: Record<Slot, Pose>; pivots: Record<Finger, Pivot>; gravity: V3 }
export function makeGeometry(pivots: Record<Finger, Pivot>, pinch: Record<Slot, V3>, dir: V3, gravity: V3): Geo {
  const gaps = {} as Record<Slot, Pose>;
  for (const s of SLOTS) gaps[s] = { c: pinch[s].slice() as V3, u: norm(dir) };
  return { zp: SLOTS.reduce((a, s) => a + gaps[s].c[2], 0) / SLOTS.length, gaps, pivots, gravity };
}

/** Pen pose resting in a slot (wobble: a small turn about the hand normal, for the catch settle). */
export function slotPose(slot: Slot, geo: Geo, wobble = 0): Pose {
  const g = geo.gaps[slot];
  return { c: g.c.slice() as V3, u: wobble ? norm(rot(Z, wobble, g.u)) : g.u.slice() as V3 };
}

export interface Resolved { seg: Seg; from: Slot; to: Slot; u: number; index: number }
/** Which segment of a trick is running at progress u, with its own start/end slot and progress. */
export function resolve(trick: Trick, from: Slot, u: number): Resolved {
  let t = clamp01(u) * trick.ms, s = from;
  for (let i = 0; ; i++) {
    const sg = trick.segs[i]!, to = sg.moves[s]!;
    if (t <= sg.ms || i === trick.segs.length - 1) return { seg: sg, from: s, to, u: clamp01(t / sg.ms), index: i };
    t -= sg.ms; s = to;
  }
}

/** Pen pose at progress u (0..1) of a trick started in slot `from`. */
export function penAt(trick: Trick, from: Slot, geo: Geo, u: number): Pose {
  const r = resolve(trick, from, u), sg = r.seg;
  return sg.kind === "orbit" ? orbitAt(sg, r.from, r.to, geo, r.u) : sg.kind === "wiper" ? wiperAt(sg, r.from, r.to, geo, r.u) : conicAt(sg, r.from, r.to, geo, r.u);
}

const alignTo = (a: V3, b: V3) => (dot(a, b) < 0 ? mul(b, -1) : b);   // the pen is symmetric: +u and -u look alike
const rigid = (P: Pose, Q: V3, k: V3, ang: number): Pose => ({ c: add(Q, rot(k, ang, sub(P.c, Q))), u: rot(k, ang, P.u) });
/** Bring a moving pose onto the slot it must land in: the leftover offset and turn are taken out over the
 *  catch (the catching fingers guide it in). E = where the free motion would end, B = the slot. */
function landOn(P: Pose, E: Pose, B: Pose, s: number): Pose {
  const target = alignTo(E.u, B.u), ax = cross(E.u, target), sn = Math.hypot(...ax);
  const u = sn > 1e-9 ? rot(mul(ax, 1 / sn), Math.atan2(sn, dot(E.u, target)) * s, P.u) : P.u;
  return { c: add(P.c, mul(sub(B.c, E.c), s)), u: norm(u) };
}
const catchBlend = (u: number) => smooth(clamp01((u - 0.55) / 0.45));
const wobble = (sg: Seg, u: number) => (sg.wob || 0) * D2R * Math.sin(Math.PI * u) * (1 - 0.4 * u);

function orbitAt(sg: Seg, from: Slot, to: Slot, geo: Geo, u: number): Pose {
  const A = slotPose(from, geo), B = slotPose(to, geo), spin = sg.spin! * D2R;
  let Q: V3, f: V3;
  if (sg.pair) {                                   // around two fingers together: about the middle of both
    const a = geo.pivots[sg.pair[0]], b = geo.pivots[sg.pair[1]];
    Q = lerp(a.p, b.p, 0.5); f = norm(add(a.f, b.f));
  } else {
    const pv = geo.pivots[typeof sg.pivot === "string" ? sg.pivot : sg.pivot![from]!];
    Q = pv.p; f = pv.f;
  }
  const g = sg.gamma ?? 0.75, k = norm(add(mul(Z, Math.cos(g)), mul(f, Math.sin(g))));
  const P = rigid(A, Q, k, spin * profile(u) + wobble(sg, u)), E = rigid(A, Q, k, spin);
  return landOn(P, E, B, catchBlend(u));
}

/** Charge (in place) and Sonic (moving one gap): the pen spins about the hand's normal through the pinch,
 *  its tilt kept so its ends trace a cone. Shadow (free): let go in the middle, flying a real gravity arc. */
function conicAt(sg: Seg, from: Slot, to: Slot, geo: Geo, u: number): Pose {
  const A = slotPose(from, geo), B = slotPose(to, geo), spin = sg.spin! * D2R;
  const path = (x: number) => { const p = lerp(A.c, B.c, smooth(x)); return from !== to ? add(p, [0, 0.006 * Math.sin(Math.PI * x), 0.02 * Math.sin(Math.PI * x)]) : p; };
  let c = path(u), ang = spin * profile(u) + wobble(sg, u);
  if (sg.free) {
    const T = (sg.ms / 1000) * TEMPO, a0 = 0.3, a1 = 0.7, tf = T * (a1 - a0), w = clamp01((u - a0) / (a1 - a0));
    if (u > a0 && u < a1) c = add(lerp(path(a0), path(a1), w), mul(geo.gravity, -0.5 * G * tf * tf * (w - w * w)));
    ang = spin * profile(u, a0, a1) + wobble(sg, u);
  }
  return landOn({ c, u: rot(Z, ang, A.u) }, { c: B.c, u: rot(Z, spin, A.u) }, B, catchBlend(u));
}

/** Wiper: held near one end; it slides out, swings half a turn up over the hand and slides back. */
function wiperAt(sg: Seg, from: Slot, to: Slot, geo: Geo, u: number): Pose {
  const A = slotPose(from, geo), sw = sg.swings!, n = sw.length, L = 0.078;
  const slide = u < 0.18 ? smooth(u / 0.18) : u > 0.82 ? smooth((1 - u) / 0.18) : 1;
  const w = clamp01((u - 0.18) / 0.64) * n, i = Math.min(n - 1, Math.floor(w));
  let ang = 0;
  for (let q = 0; q < i; q++) ang += sw[q]! * D2R;
  ang += sw[i]! * D2R * profile(clamp01(w - i));
  const side = Math.sign(sw[0]!) || 1, base = mul(A.u, side);   // a Rev wiper holds the other end: always swings UP
  const k = norm(cross(norm([base[0], base[1], 0]), Z)), dir = rot(k, ang * side, base);
  const total = sw.reduce((a, b) => a + b, 0) * D2R;
  return landOn({ c: add(A.c, mul(dir, L * slide)), u: dir }, { c: A.c, u: rot(k, total * side, base) }, slotPose(to, geo), smooth(clamp01((u - 0.82) / 0.18)));
}

// ------------------------------------------- what the hand needs to know ----
export type PenState = { kind: "spin"; trick: Trick; from: Slot; u: number } | { kind: "hold"; slot: Slot } | { kind: "drop" };

/** True while the pen flies free (Shadow's middle): no finger holds it. */
export const isFree = (r: Resolved) => r.seg.kind === "hop" && !!r.seg.free && r.u > 0.3 && r.u < 0.7;

/** Fingers that keep touching the pen with their pads (they never lift out of its way). */
export function contacts(st: PenState): Finger[] {
  if (st.kind === "hold") return GAP[st.slot];
  if (st.kind !== "spin") return [];
  const r = resolve(st.trick, st.from, st.u), sg = r.seg;
  if (sg.kind === "orbit") {
    if (sg.pair) return r.u < 0.15 ? GAP[r.from] : r.u > 0.85 ? GAP[r.to] : [];
    return [typeof sg.pivot === "string" ? sg.pivot : sg.pivot![r.from]!];
  }
  if (sg.kind === "hop") return sg.free ? (r.u < 0.3 ? GAP[r.from] : r.u > 0.7 ? GAP[r.to] : []) : r.u < 0.12 ? GAP[r.from] : r.u > 0.88 ? GAP[r.to] : [];
  return GAP[r.from];                               // conic, wiper: the grip holds it
}

/** Extra knuckle (MCP) bend per finger in degrees: + curls, - lifts (the push flick, the catch, a Bust's bump). */
export function fingerOffsets(st: PenState): Partial<Record<Finger, number>> {
  if (st.kind !== "spin") return {};
  const r = resolve(st.trick, st.from, st.u), out: Partial<Record<Finger, number>> = {};
  const f = r.seg.push as Finger | undefined;
  if (r.index === 0 && f && (f as string) !== "wrist") out[f] = 26 * Math.sin(Math.PI * clamp01(r.u / 0.16));
  if (r.index === st.trick.segs.length - 1) for (const g of GAP[r.to]) out[g] = (out[g] || 0) - 12 * Math.sin(Math.PI * clamp01((r.u - 0.58) / 0.32));
  if (r.seg.bump) out[r.seg.bump] = (out[r.seg.bump] || 0) - 30 * Math.max(0, Math.sin(Math.PI * clamp01(r.u * 2.2)));
  return out;
}

/** Wrist motion for the moment: roll (deg), yaw (rad), lift (m). */
export function wrist(st: PenState) {
  const out = { roll: 0, yaw: 0, lift: 0 };
  if (st.kind !== "spin") return out;
  const { seg: sg, u } = resolve(st.trick, st.from, st.u), b = Math.sin(Math.PI * u), sgn = Math.sign(sg.spin || 1);
  if (sg.kind !== "wiper") out.yaw = -0.05 * b * sgn;
  if (sg.fl) out.yaw += -0.16 * Math.sin(Math.PI * clamp01(u / 0.35)) * sgn;   // fingerless: a wrist flick
  if ((sg.gamma ?? 0) > 1) { out.roll = -10 * b; out.lift = 0.008 * b; }      // Backaround: the wrist turn
  if (sg.kind === "wiper") out.yaw = -0.06 * Math.sin(Math.PI * u * sg.swings!.length);
  return out;
}

// -------------------------------------------------------------- learning ----
const HOWTO: Record<string, string[]> = {
  ta: ["Rest the pen on the middle finger at its balance point, thumb on top.", "The middle finger pushes it against the thumb; let the index go.", "It turns once around the thumb; the index catches it."],
  charge: ["Hold the pen between the middle and ring fingers.", "The middle finger pushes back while the ring finger pushes forward.", "Let it make a full conic turn between them."],
  sonic: ["Hold it slanted between the middle and ring fingers.", "Press down with the middle finger; the thumb pushes it off.", "Index moves in: catch between index and middle, one gap nearer the thumb."],
  tsonic: ["Grip as for a Sonic.", "Bend the middle finger back and stretch the fingers: half a Charge.", "Then a Pass ends it between index and middle."],
  pass: ["Hold the pen between index and middle.", "The index rolls it to the front of the middle finger.", "The ring finger dips, then lifts to lock it in the next gap."],
  wiper: ["Hold the pen near one end between two fingers.", "Swing the free end up over the hand: half a turn.", "It stays in the same gap."],
  inf: ["A figure eight: Wiper > Pass > Wiper > Pass Rev, held near one end in the wipers."],
  bak: ["A fingerless reverse Around: a turn of the wrist throws it round the back of the index.", "It lands back in the same gap."],
  bust: ["A Backaround Reverse with an upward bump from the finger next to it."],
  shadow: ["Start like a Sonic, but let go: about one and a half free turns.", "It flies a short arc under gravity and lands one gap nearer the thumb."],
  ia: ["Push once, at the start: one full turn around the index finger."],
  fpass: ["Pass > Pass > Pass all the way to the pinky, then Pass Rev back to the start."],
};
const VID: Record<string, string> = {
  ta: "XBfiQEoQZDw", tar: "d32ufaR9QIs", tah: "IZIqyMDS8C4", exta: "_e0aH-0OIeA", flta: "2YYDfz1133c", charge: "XddJ_YiNyJI",
  charger: "YfBfy7lCNsI", sonic: "ueeZ3W7DIQo", sonicr: "lNeTo-uUd2k", tsonic: "gmFYP3J1C6I", tsbust: "-3Dym3Rx-38", msonic: "keCXY1zvQgs",
  pass: "8YVDnByth_Q", passr: "NimogvQTdUg", wiper: "oKRQBP1LRaM", inf: "diT0wT7scfQ", inf2: "NiuFH1StmLI", bak: "8qCitjI3Dx4",
  kbak: "DPFTVavvLfI", bakfall: "AJp1Rhi4DS0", neo: "GnMmulpAMM8", ia: "nDQNln8T9IY",
};
const VID_ALIAS: Record<string, string> = { fltar: "flta", ta15: "ta", ta2: "ta", ta2r: "tar", rfans: "charge", ffans: "charger", sonicrise: "sonic", sonicfall: "sonicr",
  sonicm: "sonic", sonich: "sonic", csonic: "sonic", shadow: "sonic", tsonicr: "tsonic", dcharge: "tsonic", bust: "tsbust", demon: "sonic", msonicr: "msonic",
  passu: "pass", passrd: "passr", fpass: "pass", fpassr: "passr", wiperr: "wiper", wiperh: "wiper", infr: "inf", bakr: "bak", mbak: "bakfall", rbak: "bakfall",
  pbak: "bakfall", neor: "neo", iar: "ia", ma: "ia", mar: "ia", ra: "ia", rar: "ia", flia: "ia" };
/** A tutorial video for the trick (checked links from the original catalog), or a search. */
export function videoFor(t: Trick) {
  const v = VID[t.id] || VID[VID_ALIAS[t.id] || ""];
  return v ? "https://www.youtube.com/watch?v=" + v : "https://www.youtube.com/results?search_query=" + encodeURIComponent(t.name + " pen spinning tutorial");
}
/** Steps for any trick: the tutorial's, or written from its moves. */
export function howTo(t: Trick): string[] {
  if (HOWTO[t.id]) return HOWTO[t.id]!;
  const from = Object.keys(t.moves)[0] as Slot, out = [`Start in gap ${from} (${GAP[from].join(" + ")}).`];
  if (t.push) out.push(`Push: ${t.push === "wrist" ? "a flick of the wrist" : "the " + t.push}.`);
  let s = from;
  for (const sg of t.segs) {
    const to = sg.moves[s]!, pv = sg.pivot ? (typeof sg.pivot === "string" ? sg.pivot : sg.pivot[s]) : null, turns = Math.abs(sg.spin || 0) / 360;
    const what = sg.kind === "orbit" ? (sg.pair ? `round the ${sg.pair.join(" and ")}` : (sg.gamma ?? 0) > 1 ? `round the back of the ${pv}` : `round the ${pv}`)
      : sg.kind === "conic" ? "in place, ends tracing a cone" : sg.kind === "hop" ? (sg.free ? "free, under gravity" : "sliding to the next gap") : "held at one end, swinging up";
    out.push(`${turns ? `${turns} turn${turns === 1 ? "" : "s"} ` : ""}${what}: ${s} → ${to}.`);
    s = to;
  }
  out.push(`Catch: ${GAP[s].join(" + ")}.`);
  return out;
}
