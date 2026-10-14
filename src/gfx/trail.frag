precision mediump float;
uniform vec3 uCol;
in float vA;
out vec4 o;
void main() { o = vec4(uCol * vA, vA); }
