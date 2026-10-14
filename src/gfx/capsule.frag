uniform vec3 uMat[4];   // skin, pen body, pen caps, pen bands
in vec3 vP, vN;
flat in vec3 vM;
flat in float vSkin;
out vec4 o;
void main() {
  o = vec4(post(shade(vP, normalize(vN), uMat[int(vM.x)], vM.z, vSkin, vM.y), vP), 1);
}
