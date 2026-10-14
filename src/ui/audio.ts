/* Synthesised sound effects (no audio files) and haptics. */
let ac: AudioContext | null = null, pending = false;
export const fx = { sound: true, haptics: true };

/** Called from taps. Creating an AudioContext is slow (it opens the audio device), so it happens after the tap
 *  has painted; the browser still counts the tap as the user gesture that lets sound play. */
export function unlock() {
  if (!fx.sound) return;
  if (ac) { if (ac.state === "suspended") void ac.resume(); return; }
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => setTimeout(() => { try { ac = new AudioContext(); void ac.resume(); } catch { /* no audio */ } }));
}
export const ctx = () => ac;

function tone(freq: number, dur = 0.08, type: OscillatorType = "triangle", vol = 0.12, when = 0, slide = 0) {
  if (!fx.sound || !ac) return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
export const buzz = (p: number | number[]) => { if (fx.haptics && navigator.vibrate) navigator.vibrate(p); };
export const sfx = {
  catch: (chain: number) => tone(420 + Math.min(chain, 30) * 22, 0.06, "square", 0.04),
  perfect: () => { tone(1320, 0.09, "sine", 0.12); tone(1760, 0.14, "sine", 0.09, 0.05); buzz([12, 30, 12]); },
  good: () => { tone(880, 0.07, "triangle", 0.08); buzz(10); },
  drop: () => { tone(220, 0.25, "sawtooth", 0.08, 0, 0.35); tone(90, 0.18, "sine", 0.25, 0.12); buzz([50, 40, 80]); },
  end: (chain: number) => [0, 4, 7, 12].forEach((s, i) => tone(523 * 2 ** (s / 12), 0.16, "triangle", 0.09, i * 0.07 * (chain > 9 ? 0.7 : 1))),
  link: () => tone(990, 0.06, "sine", 0.07, 0.03),
  unlock: () => [0, 7, 12, 16, 19].forEach((s, i) => tone(392 * 2 ** (s / 12), 0.22, "sine", 0.08, i * 0.08)),
  beat: (when: number) => tone(1000, 0.05, "square", 0.1, when),
};
