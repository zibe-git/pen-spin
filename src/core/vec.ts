/** Tiny 3D vector maths on plain tuples. Hand space: metres, x = towards the pinky, y = along the fingers,
 *  z = back of the hand. World space: z up (the desk is z = 0). */
export type V3 = [number, number, number];

export const D2R = Math.PI / 180;
export const X: V3 = [1, 0, 0], Y: V3 = [0, 1, 0], Z: V3 = [0, 0, 1];

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: V3, s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a: V3): V3 => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (u: number) => u * u * (3 - 2 * u);

/** Rodrigues rotation of v about the unit axis k by ang radians (right-handed). */
export function rot(k: V3, ang: number, v: V3): V3 {
  const c = Math.cos(ang), s = Math.sin(ang), kv = cross(k, v), d = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * d, v[1] * c + kv[1] * s + k[1] * d, v[2] * c + kv[2] * s + k[2] * d];
}

/** 3x3 matrices, row-major. mat3(f) samples the linear map f. */
export type M3 = number[];
export const mat3 = (f: (v: V3) => V3): M3 => { const a = f(X), b = f(Y), c = f(Z); return [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]]; };
export const mv = (A: M3, v: V3): V3 => [A[0] * v[0] + A[1] * v[1] + A[2] * v[2], A[3] * v[0] + A[4] * v[1] + A[5] * v[2], A[6] * v[0] + A[7] * v[1] + A[8] * v[2]];
export const mm = (A: M3, B: M3): M3 => mat3((v) => mv(A, mv(B, v)));

/** Closest points of two segments (Ericson, Real-Time Collision Detection). */
export function segSeg(p1: V3, q1: V3, p2: V3, q2: V3) {
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2), a = dot(d1, d1), e = dot(d2, d2), f = dot(d2, r);
  let s = 0, t = 0;
  if (a > 1e-12 || e > 1e-12) {
    if (a <= 1e-12) t = clamp01(f / e);
    else {
      const c = dot(d1, r);
      if (e <= 1e-12) s = clamp01(-c / a);
      else {
        const b = dot(d1, d2), den = a * e - b * b;
        s = den > 1e-14 ? clamp01((b * f - c * e) / den) : 0;
        t = (b * s + f) / e;
        if (t < 0) { t = 0; s = clamp01(-c / a); } else if (t > 1) { t = 1; s = clamp01((b - c) / a); }
      }
    }
  }
  const c1 = add(p1, mul(d1, s)), c2 = add(p2, mul(d2, t));
  return { s, t, c1, c2, d: len(sub(c1, c2)) };
}
