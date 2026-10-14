// The desk: varnished wood with a sheet of ruled paper on it.
in vec3 vP;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + 1.), f.x), f.y);
}
void main() {
  vec2 q = vP.xy;
  float g = noise(vec2(q.x * 5., q.y * 260. + noise(q * vec2(4., 30.)) * 3.)) * .7 + noise(q * vec2(2., 60.)) * .3;
  vec3 alb = mix(vec3(.075, .04, .022), vec3(.16, .09, .05), g) * (.85 + .3 * noise(q * 40.));
  float gloss = .32;
  // paper: A4, turned 12 degrees, ruled every 8 mm with a margin
  vec2 pp = mat2(.978, -.208, .208, .978) * (q - vec2(.10, .04));
  vec2 e = abs(pp) - vec2(.105, .1485);
  if (max(e.x, e.y) < 0.) {
    float aa = fwidth(pp.y) * 1.5;
    float rule = 1. - smoothstep(0., aa + .0002, abs(fract(pp.y / .008 + .5) - .5) * .008);
    float margin = 1. - smoothstep(0., aa + .0003, abs(pp.x + .075));
    alb = mix(vec3(.62, .61, .58), vec3(.25, .37, .6), rule * .45);
    alb = mix(alb, vec3(.78, .30, .30), margin * .6);
    gloss = .02;
  }
  o = vec4(post(shade(vP, vec3(0, 0, 1), alb, gloss, 0., -1.), vP), 1);
}
