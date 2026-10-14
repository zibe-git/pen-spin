// Motion streaks behind the pen's ends (drawn additive). Vertex: xyz + alpha.
uniform mat4 uVP;
in vec4 aP;
out float vA;
void main() {
  vA = aP.w;
  gl_Position = uVP * vec4(aP.xyz, 1);
}
