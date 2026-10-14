// Shared lighting: one warm desk lamp, a cool sky fill, and analytic soft shadows + occlusion from every
// capsule (fingers, palm, forearm, pen). No shadow maps, no textures.
precision highp float;
uniform vec3 uEye, uL, uFocus;
uniform vec4 uCA[20], uCB[20];   // casters: a.xyz + radius, b.xyz + group
uniform int uN;
const vec3 BG = vec3(.059, .066, .082);

// x: shadow from the lamp (soft, penumbra grows with distance), y: ambient occlusion
vec2 occl(vec3 p, vec3 n, float self) {
  float sh = 1., ao = 1.;
  vec3 ro = p + n * .0006;
  for (int i = 0; i < 20; i++) {
    if (i >= uN) break;
    vec4 A = uCA[i], B = uCB[i];
    if (B.w == self) continue;
    vec3 a = A.xyz, ba = B.xyz - a, oa = ro - a;
    float r = A.w, bb = dot(ba, ba) + 1e-9;
    vec3 v = ba * clamp(dot(oa, ba) / bb, 0., 1.) - oa;
    float d = length(v);
    if (d < r * 1.04) continue;                       // touching it (a joint): no self-darkening
    ao *= 1. - .85 * clamp(dot(n, v / d) * .6 + .4, 0., 1.) * min(1., r * r / (d * d) * 1.6);
    float bl = dot(ba, uL), den = bb - bl * bl;
    float s = den > 1e-9 ? clamp((dot(ba, oa) - dot(uL, oa) * bl) / den, 0., 1.) : 0.;
    vec3 q = a + ba * s;
    float t = dot(q - ro, uL);
    if (t > 0.) sh = min(sh, smoothstep(0., 1., (length(ro + uL * t - q) - r) / (t * .09) + .5));
  }
  return vec2(sh, ao);
}

vec3 shade(vec3 p, vec3 n, vec3 alb, float gloss, float skin, float self) {
  vec3 V = normalize(uEye - p), H = normalize(uL + V);
  vec2 so = occl(p, n, self);
  float pool = mix(.22, 1., smoothstep(.55, .04, length(p.xy - uFocus.xy)));   // the lamp's light pool
  float ndl = dot(n, uL), w = skin * .4;
  float dif = max((ndl + w) / (1. + w), 0.) * so.x * pool;
  float sp = pow(max(dot(n, H), 0.), mix(10., 700., gloss)) * mix(.03, 1.6, gloss) * so.x * pool * step(0., ndl);
  float fr = pow(1. - max(dot(n, V), 0.), 4.);
  vec3 sky = mix(vec3(.07, .055, .05), vec3(.16, .19, .26), n.z * .5 + .5);
  vec3 key = vec3(1., .84, .66) * 2.3;
  vec3 c = alb * (sky * so.y + key * dif);
  c += skin * alb * vec3(1., .28, .14) * max(0., 1. - abs(ndl) * 2.2) * .5 * so.x * pool;   // light bleeding through skin
  c += key * sp + vec3(.3, .42, .85) * fr * (.12 + gloss * .5) * so.y;
  return c;
}

vec3 post(vec3 c, vec3 p) {
  c = clamp((c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14), 0., 1.);  // ACES
  c = pow(c, vec3(1. / 2.2));
  c = mix(c, BG, smoothstep(.2, .75, length(p.xy - uFocus.xy)));
  return c + (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - .5) / 255.;   // dither
}
