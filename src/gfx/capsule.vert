// One unit capsule mesh, instanced: each instance stretches it between two points with two radii.
// aDir: unit direction in the capsule frame (y = axis), aEnd: 0 = the A cap, 1 = the B cap.
uniform mat4 uVP;
in vec3 aDir;
in float aEnd;
in vec4 iA, iB, iN, iM;   // a.xyz + r0, b.xyz + r1, flatten hint.xyz + flatten, material, group, gloss
out vec3 vP, vN;
flat out vec3 vM;
flat out float vSkin;
void main() {
  vec3 ax = iB.xyz - iA.xyz;
  float l = length(ax);
  vec3 Y = l > 1e-6 ? ax / l : vec3(0, 0, 1);
  vec3 h = iN.xyz - Y * dot(iN.xyz, Y);
  vec3 Z = dot(h, h) > 1e-8 ? normalize(h) : normalize(cross(Y, abs(Y.x) < .9 ? vec3(1, 0, 0) : vec3(0, 1, 0)));
  vec3 X = cross(Y, Z);
  float f = iN.w;
  vP = mix(iA.xyz, iB.xyz, aEnd) + (X * aDir.x + Y * aDir.y + Z * aDir.z * f) * mix(iA.w, iB.w, aEnd);
  vN = normalize(X * aDir.x + Y * aDir.y + Z * aDir.z / f);
  vM = iM.xyz;
  vSkin = iM.x == 0. ? 1. : 0.;
  gl_Position = uVP * vec4(vP, 1);
}
