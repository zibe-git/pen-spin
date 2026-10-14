/* WebGL2 renderer: the whole scene is ~23 instanced capsules on a procedural desk, lit by one lamp with
 * analytic soft shadows (common.glsl). One draw call for the hand and pen, one for the desk, one for the trails.
 * Resolution adapts to keep the frame rate up; a lost context is rebuilt. */
import { type V3, add, sub, mul, norm, cross, dot, len } from "../core/vec";
import type { Frame } from "../sim/hand";
import { PEN_R, PEN_HALF } from "../sim/hand";
import COMMON from "./common.glsl";
import CAP_VS from "./capsule.vert";
import CAP_FS from "./capsule.frag";
import DESK_VS from "./desk.vert";
import DESK_FS from "./desk.frag";
import TRAIL_VS from "./trail.vert";
import TRAIL_FS from "./trail.frag";

export interface View { eye: V3; look: V3; fov: number; shiftY: number }

const HEAD = "#version 300 es\n";
const MAX = 24, STRIDE = 16, TRAIL_N = 10;
const LIGHT = norm([-0.40, 0.45, 0.80]);                 // towards the lamp (hand space x mirrors for a left hand)

type GL = WebGL2RenderingContext;
/** Compile + link without asking for the result (that would block until the driver is done). */
function compile(gl: GL, vs: string, fs: string) {
  const p = gl.createProgram()!;
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]] as const) {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, HEAD + src);
    gl.compileShader(s);
    gl.attachShader(p, s);
  }
  gl.linkProgram(p);
  return p;
}
function program(gl: GL, p: WebGLProgram) {
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost())
    throw new Error(gl.getProgramInfoLog(p) + " " + gl.getAttachedShaders(p)!.map((s) => gl.getShaderInfoLog(s)).join(" "));
  const u: Record<string, WebGLUniformLocation | null> = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i)!.name.replace("[0]", ""); u[name] = gl.getUniformLocation(p, name); }
  return { p, u };
}

/** The unit capsule: two hemispheres (end 0 and end 1) whose equators are joined by the cylinder. */
function capsuleMesh() {
  const SEG = 18, RINGS = 6, v: number[] = [], idx: number[] = [];
  for (let end = 0; end < 2; end++)
    for (let i = 0; i <= RINGS; i++) {
      const phi = (end - 1 + i / RINGS) * Math.PI / 2;
      for (let j = 0; j <= SEG; j++) {
        const th = (j / SEG) * Math.PI * 2;
        v.push(Math.cos(phi) * Math.cos(th), Math.sin(phi), Math.cos(phi) * Math.sin(th), end);
      }
    }
  const rows = 2 * (RINGS + 1), W = SEG + 1;
  for (let r = 0; r < rows - 1; r++)
    for (let j = 0; j < SEG; j++) {
      const a = r * W + j, b = a + W;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  return { v: new Float32Array(v), i: new Uint16Array(idx) };
}

function perspective(fovY: number, aspect: number, near: number, far: number, shiftY: number) {
  const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, -shiftY, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}
function lookAt(eye: V3, at: V3, up: V3) {
  const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}
function mul4(a: number[], b: number[]) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}
const hex = (h: string): V3 => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255].map((c) => c ** 2.2) as V3; };

export function createRenderer(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const gl = canvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance", depth: true, stencil: false }) as WebGL2RenderingContext | null;
  if (!gl) return null;
  let cap: ReturnType<typeof program>, desk: ReturnType<typeof program>, trail: ReturnType<typeof program>;
  let capVao: WebGLVertexArrayObject, deskVao: WebGLVertexArrayObject, trailVao: WebGLVertexArrayObject;
  let inst: WebGLBuffer, trailBuf: WebGLBuffer, nIdx = 0, lost = false;
  const data = new Float32Array(MAX * STRIDE), ca = new Float32Array(20 * 4), cb = new Float32Array(20 * 4);
  const trailData = new Float32Array(2 * TRAIL_N * 2 * 4);

  /** Shaders compile in the background when the driver can (KHR_parallel_shader_compile): no long task. */
  async function init() {
    const ps = [compile(gl!, CAP_VS, COMMON + CAP_FS), compile(gl!, DESK_VS, COMMON + DESK_FS), compile(gl!, TRAIL_VS, TRAIL_FS)];
    const par = gl!.getExtension("KHR_parallel_shader_compile");
    if (par) while (!ps.every((p) => gl!.getProgramParameter(p, par.COMPLETION_STATUS_KHR))) await new Promise((r) => setTimeout(r, 16));
    [cap, desk, trail] = ps.map((p) => program(gl!, p)) as [typeof cap, typeof cap, typeof cap];
    gl!.enable(gl!.DEPTH_TEST);
    gl!.enable(gl!.CULL_FACE);
    const m = capsuleMesh();
    nIdx = m.i.length;
    capVao = gl!.createVertexArray()!;
    gl!.bindVertexArray(capVao);
    const vb = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vb);
    gl!.bufferData(gl!.ARRAY_BUFFER, m.v, gl!.STATIC_DRAW);
    const loc = (p: WebGLProgram, n: string) => gl!.getAttribLocation(p, n);
    gl!.enableVertexAttribArray(loc(cap.p, "aDir")); gl!.vertexAttribPointer(loc(cap.p, "aDir"), 3, gl!.FLOAT, false, 16, 0);
    gl!.enableVertexAttribArray(loc(cap.p, "aEnd")); gl!.vertexAttribPointer(loc(cap.p, "aEnd"), 1, gl!.FLOAT, false, 16, 12);
    const ib = gl!.createBuffer();
    gl!.bindBuffer(gl!.ELEMENT_ARRAY_BUFFER, ib);
    gl!.bufferData(gl!.ELEMENT_ARRAY_BUFFER, m.i, gl!.STATIC_DRAW);
    inst = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, inst);
    gl!.bufferData(gl!.ARRAY_BUFFER, data.byteLength, gl!.DYNAMIC_DRAW);
    ["iA", "iB", "iN", "iM"].forEach((n, k) => {
      const l = loc(cap.p, n);
      gl!.enableVertexAttribArray(l); gl!.vertexAttribPointer(l, 4, gl!.FLOAT, false, STRIDE * 4, k * 16); gl!.vertexAttribDivisor(l, 1);
    });
    deskVao = gl!.createVertexArray()!;
    gl!.bindVertexArray(deskVao);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gl!.createBuffer());
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl!.STATIC_DRAW);
    gl!.enableVertexAttribArray(loc(desk.p, "aXY")); gl!.vertexAttribPointer(loc(desk.p, "aXY"), 2, gl!.FLOAT, false, 0, 0);
    trailVao = gl!.createVertexArray()!;
    gl!.bindVertexArray(trailVao);
    trailBuf = gl!.createBuffer()!;
    gl!.bindBuffer(gl!.ARRAY_BUFFER, trailBuf);
    gl!.bufferData(gl!.ARRAY_BUFFER, trailData.byteLength, gl!.DYNAMIC_DRAW);
    gl!.enableVertexAttribArray(loc(trail.p, "aP")); gl!.vertexAttribPointer(loc(trail.p, "aP"), 4, gl!.FLOAT, false, 0, 0);
    gl!.bindVertexArray(null);
  }
  const ready = init();
  const onLost = (e: Event) => { e.preventDefault(); lost = true; }, onBack = () => { void init().then(() => { lost = false; }); };
  for (const p of ["webgl", ""]) { canvas.addEventListener(p + "contextlost", onLost); canvas.addEventListener(p + "contextrestored", onBack); }

  // ---- adaptive resolution: drop pixels when frames run long, win them back when there is headroom ----
  let scale = 1, slow = 0, fast = 0, lastT = 0, w = 0, h = 0, cw = 1, ch = 1, dprCap = 1;
  function fit(now: number) {
    const dt = lastT ? now - lastT : 16;
    lastT = now;
    if (dt > 21 && dt < 200) { fast = 0; if (++slow > 20 && scale > 0.5) { scale = Math.max(0.5, scale * 0.85); slow = 0; } }
    else if (dt < 18) { slow = Math.max(0, slow - 1); if (++fast > 180 && scale < 1) { scale = Math.min(1, scale * 1.1); fast = 0; } }
    const s = dprCap * scale;
    const W = Math.max(1, Math.round(cw * s)), H = Math.max(1, Math.round(ch * s));
    if (W !== w || H !== h) { canvas.width = w = W; canvas.height = h = H; }
  }

  // ---- trails: the last positions of each pen end ----
  const hist: V3[][] = [[], []];
  let prevU: V3 | null = null, glow = 0;

  const mats = { skin: hex("#d29a7e"), pen: hex("#e8453c"), cap: hex("#15171c"), band: hex("#eeeeee") };
  let penCol: V3 = [0.91, 0.27, 0.24];

  return {
    ready,
    /** The canvas size in CSS pixels and the device pixel ratio (capped at 2: more is invisible on a phone). */
    resize(width: number, height: number, dpr: number) { cw = Math.max(1, width); ch = Math.max(1, height); dprCap = Math.min(dpr || 1, 2); },
    setPen(h: string) { mats.pen = hex(h); penCol = hex(h).map((c) => c ** (1 / 2.2)) as V3; },
    /** Draw a frame. side = -1 mirrors the world for a left hand: only the capsule end points move, and each
     *  capsule is rebuilt in a right-handed frame, so its triangles stay front-facing. */
    draw(f: Frame, v: View, side: number, now: number, dt: number) {
      if (lost) return;
      fit(now);
      const M = (p: V3): V3 => [p[0] * side, p[1], p[2]];
      let n = 0, nc = 0;
      const put = (a: V3, b: V3, r0: number, r1: number, mat: number, group: number, gloss: number, hint: V3 = [0, 0, 0], flat = 1, caster = 0) => {
        const o = n++ * STRIDE, A = M(a), B = M(b), Hn = M(hint);
        data.set([A[0], A[1], A[2], r0, B[0], B[1], B[2], r1, Hn[0], Hn[1], Hn[2], flat, mat, group, gloss, 0], o);
        if (caster) { ca.set([A[0], A[1], A[2], caster], nc * 4); cb.set([B[0], B[1], B[2], group], nc * 4); nc++; }
      };
      f.bones.forEach((b, i) => put(b.a, b.b, b.r0, b.r1, 0, 2 + i, 0.28, undefined, 1, Math.max(b.r0, b.r1)));
      const p = f.palm;
      put(add(p.c, mul(p.y, -0.012)), add(p.c, mul(p.y, 0.012)), 0.04, 0.04, 0, 30, 0.28, p.z, 0.4, 0.032);
      put(f.fore.a, f.fore.b, f.fore.r0, f.fore.r1, 0, 31, 0.28, undefined, 1, 0.03);
      const c = f.pen.c, u = f.pen.u, at = (s: number) => add(c, mul(u, s));
      put(at(-(PEN_HALF - 0.02)), at(PEN_HALF - 0.02), PEN_R, PEN_R, 1, 1, 0.75, undefined, 1, PEN_R);
      for (const s of [-1, 1]) {
        put(at(s * (PEN_HALF - 0.026)), at(s * (PEN_HALF - 0.0045)), PEN_R * 1.075, PEN_R * 0.88, 2, 1, 0.9);
        put(at(s * 0.025), at(s * 0.031), PEN_R * 1.06, PEN_R * 1.06, 3, 1, 0.8);
      }
      put(at(-0.006), at(0.006), PEN_R * 1.1, PEN_R * 1.1, 2, 1, 0.9);

      // camera
      const aspect = cw / ch;
      const eye = M(v.eye), look = M(v.look);
      const vp = mul4(perspective(v.fov, aspect, 0.01, 4, v.shiftY), lookAt(eye, look, [0, 0, 1]));
      const L: V3 = [LIGHT[0] * side, LIGHT[1], LIGHT[2]];

      gl.viewport(0, 0, w, h);
      gl.clearColor(0.059, 0.066, 0.082, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      for (const pr of [desk, cap]) {
        gl.useProgram(pr.p);
        gl.uniformMatrix4fv(pr.u.uVP!, false, vp);
        gl.uniform3fv(pr.u.uEye!, eye);
        gl.uniform3fv(pr.u.uL!, L);
        gl.uniform3fv(pr.u.uFocus!, look);
        gl.uniform4fv(pr.u.uCA!, ca);
        gl.uniform4fv(pr.u.uCB!, cb);
        gl.uniform1i(pr.u.uN!, nc);
      }
      gl.useProgram(desk.p);
      gl.uniform3fv(desk.u.uC!, look);
      gl.bindVertexArray(deskVao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.useProgram(cap.p);
      gl.uniform3fv(cap.u.uMat!, [...mats.skin, ...mats.pen, ...mats.cap, ...mats.band]);
      gl.bindBuffer(gl.ARRAY_BUFFER, inst);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, n * STRIDE);
      gl.bindVertexArray(capVao);
      gl.drawElementsInstanced(gl.TRIANGLES, nIdx, gl.UNSIGNED_SHORT, 0, n);

      // trails: brighter the faster the pen turns
      const ends = [at(PEN_HALF - 0.004), at(-(PEN_HALF - 0.004))].map(M);
      const ang = prevU && dt > 0 ? Math.acos(Math.min(1, Math.abs(dot(prevU, u)))) / dt : 0;
      prevU = u;
      glow += (Math.min(1, Math.max(0, (ang - 6) / 18)) - glow) * Math.min(1, dt * 12);
      let k = 0;
      ends.forEach((e, j) => {
        const hs = hist[j]!;
        hs.push(e); if (hs.length > TRAIL_N) hs.shift();
        for (let i = 0; i < TRAIL_N; i++) {
          const q = hs[Math.max(0, i - (TRAIL_N - hs.length))]!, nx = hs[Math.min(hs.length - 1, Math.max(0, i - (TRAIL_N - hs.length)) + 1)]!;
          const t = i / (TRAIL_N - 1), dir = sub(nx, q), side2 = len(dir) > 1e-6 ? norm(cross(dir, sub(eye, q))) : [0, 0, 0] as V3;
          const wdt = 0.003 * t, a = glow * t * t * 0.32;
          trailData.set([q[0] + side2[0] * wdt, q[1] + side2[1] * wdt, q[2] + side2[2] * wdt, a, q[0] - side2[0] * wdt, q[1] - side2[1] * wdt, q[2] - side2[2] * wdt, a], k);
          k += 8;
        }
      });
      if (glow > 0.01) {
        gl.useProgram(trail.p);
        gl.uniformMatrix4fv(trail.u.uVP!, false, vp);
        gl.uniform3fv(trail.u.uCol!, penCol.map((x) => Math.min(1, x * 0.6 + 0.4)));
        gl.bindBuffer(gl.ARRAY_BUFFER, trailBuf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, trailData);
        gl.bindVertexArray(trailVao);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, TRAIL_N * 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, TRAIL_N * 2, TRAIL_N * 2);
        gl.disable(gl.BLEND); gl.depthMask(true); gl.enable(gl.CULL_FACE);
      }
      gl.bindVertexArray(null);
    },
  };
}
export type Renderer = NonNullable<ReturnType<typeof createRenderer>>;
