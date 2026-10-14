/* Saved progress and settings (localStorage; private mode just means nothing is kept). */
export interface Save {
  v: 1;
  sound: boolean; haptics: boolean; western: boolean; hand: "right" | "left"; offset: number; pen: string; camera: string;
  intro: boolean;
  best: Record<string, { streak: number; score: number }>;
  landed: Record<string, number>;     // trick id -> times landed
  stars: Record<string, number>;      // combo id -> best stars
  maxStreak: number;
}
const KEY = "penspin.v1";
const fresh = (): Save => ({ v: 1, sound: true, haptics: true, western: false, hand: "right", offset: 0, pen: "#e8453c", camera: "across",
  intro: false, best: {}, landed: {}, stars: {}, maxStreak: 0 });

export function load(): Save {
  try { return { ...fresh(), ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return fresh(); }
}
let timer = 0;
/** Saved a moment later, so a burst of changes is one write (and never inside an input handler's frame). */
export function save(s: Save) {
  clearTimeout(timer);
  timer = setTimeout(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* full or private */ } }, 250) as unknown as number;
}
export function wipe(): Save { try { localStorage.removeItem(KEY); } catch { /* private */ } return fresh(); }
