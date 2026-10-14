import { describe, expect, test } from "bun:test";
import { BYID, TRICKS, penAt, slotPose, type Pose, type Slot } from "../src/core/tricks";
import { COMBOS, stars } from "../src/core/combos";
import { SpinCombo, type ComboEvent } from "../src/core/combo";
import { getGeo, step } from "../src/sim/hand";
import { dot, len, sub } from "../src/core/vec";
import { minifyGlsl } from "../scripts/build";

const geo = getGeo();
const near = (a: Pose, b: Pose, tol = 1e-3) => len(sub(a.c, b.c)) < tol && Math.abs(Math.abs(dot(a.u, b.u)) - 1) < tol;

describe("tricks", () => {
  test("catalog: unique ids, every trick can start somewhere", () => {
    expect(new Set(TRICKS.map((t) => t.id)).size).toBe(TRICKS.length);
    expect(TRICKS.length).toBeGreaterThan(70);
    for (const t of TRICKS) expect(Object.keys(t.moves).length).toBeGreaterThan(0);
  });
  test("every path starts in its slot, lands in its slot, and never jumps", () => {
    let paths = 0;
    for (const t of TRICKS) for (const [from, to] of Object.entries(t.moves) as [Slot, Slot][]) {
      paths++;
      expect(near(penAt(t, from, geo, 0), slotPose(from, geo))).toBe(true);
      expect(near(penAt(t, from, geo, 1), slotPose(to, geo))).toBe(true);
      const N = Math.ceil(t.ms / 2);                 // one sample per 2 ms of the trick
      let prev = penAt(t, from, geo, 0);
      for (let i = 1; i <= N; i++) {
        const p = penAt(t, from, geo, i / N);
        expect(len(sub(p.c, prev.c))).toBeLessThan(0.004);   // < 4 mm per 2 ms (2 m/s)
        expect(Math.abs(dot(p.u, prev.u))).toBeGreaterThan(Math.cos(0.12));
        prev = p;
      }
    }
    expect(paths).toBeGreaterThan(150);
  });
  test("the pen stays above the desk and near the hand", () => {
    let t = 0;
    for (const tr of TRICKS.slice(0, 20)) {
      const from = Object.keys(tr.moves)[0] as Slot;
      for (let u = 0; u <= 1; u += 0.05, t += 16) {
        const f = step(t, 0.016, () => ({ kind: "spin", trick: tr, from, u }));
        expect(f.pen.c[2]).toBeGreaterThan(0);
        expect(Number.isFinite(f.bones[0]!.a[0])).toBe(true);
      }
    }
  });
});

describe("combos", () => {
  test("every real combo chains: each step starts where the last one ended", () => {
    for (const c of COMBOS) {
      let s: Slot | undefined = c.start;
      for (const id of c.steps) { const t = BYID[id]; expect(t).toBeDefined(); s = t!.moves[s!]; expect(s).toBeDefined(); }
    }
  });
  test("stars", () => {
    expect(stars(3, 2)).toBe(3);
    expect(stars(3, 1)).toBe(2);
    expect(stars(5, 1)).toBe(1);
  });
});

describe("timing engine", () => {
  const run = () => { const ev: ComboEvent[] = []; return { ev, c: new SpinCombo((e) => ev.push(e)) }; };
  test("a perfect link raises the multiplier and the bonus is banked", () => {
    const { ev, c } = run(), ta = BYID.ta!;
    c.press(ta, 0);
    const cur = c.cur!;
    c.press(ta, cur.catchAt);                         // dead on the catch: PERFECT
    expect(c.mult).toBeCloseTo(1.2);
    for (let t = cur.catchAt; t < 10000; t += 10) c.update(t);
    const end = ev.find((e) => e.type === "end");
    expect(end && end.type === "end" && end.chain).toBe(2);
    expect(c.state).toBe("idle");
  });
  test("too early drops the pen and loses the bonus", () => {
    const { ev, c } = run();
    c.press(BYID.ta!, 0);
    c.press(BYID.ta!, 10);
    expect(c.state).toBe("drop");
    expect(ev.some((e) => e.type === "drop" && e.reason === "early")).toBe(true);
  });
  test("a trick that can't start from the landing gap drops", () => {
    const { ev, c } = run();
    c.press(BYID.ta!, 0);                             // 12 -> 12
    c.press(BYID.pa!, c.cur!.catchAt);                // Pinkyaround needs gap 45
    expect(ev.some((e) => e.type === "drop" && e.reason === "slot")).toBe(true);
  });
  test("links speed up and the window narrows", () => {
    const c = new SpinCombo();
    expect(c.speed(10)).toBeGreaterThan(c.speed(0));
    expect(c.timing(10).gold).toBeLessThan(c.timing(0).gold);
  });
});

test("glsl minifier keeps code intact", () => {
  expect(minifyGlsl("float a = 1. - .5; // c\nvec3 b = vec3(a, a, a);")).toBe("float a=1.-.5;vec3 b=vec3(a,a,a);");
  expect(() => minifyGlsl("x = a - -b;")).toThrow();
});
