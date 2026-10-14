uniform mat4 uVP;
uniform vec3 uC;
in vec2 aXY;
out vec3 vP;
void main() {
  vP = vec3(uC.xy + aXY * .9, 0);
  gl_Position = uVP * vec4(vP, 1);
}
