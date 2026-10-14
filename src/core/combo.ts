/* Cabal-style combo timing for pen spinning. Pure logic: presses + a clock (ms) in, events out.
 *
 *   idle ──press──▶ spin ──dur──▶ caught ──post──▶ idle      (combo ends clean: streak bonus banked)
 *                    ▲  └─[ pre | catch | post ]─┘
 *                    └──── next trick pressed inside the window (PERFECT inside the gold zone)
 *
 * Too early (before the window) or a trick that can't start from the gap the pen lands in = DROP:
 * the pen falls on the desk and the streak bonus is lost. Tricks already landed keep their points.
 * Every link makes the next trick faster and the window narrower.
 */
import type { Slot, Trick } from "./tricks";

const MAX_MULT = 5;
const PERFECT_GAIN = 0.2;     // multiplier gained per perfect link
const REPEAT_FACTOR = 0.5;    // same trick twice in a row scores half
const BONUS_PER_LINK2 = 10;   // clean finish bonus = streak^2 * this * multiplier
export const DROP_MS = 1600;  // pen on the desk before the hand picks it up again
const MAX_SPEED = 1.9;

export type Quality = "start" | "perfect" | "good";
export interface Cur {
  trick: Trick; from: Slot; to: Slot; t0: number; dur: number; catchAt: number;
  winStart: number; winEnd: number; goldStart: number; goldEnd: number; landed: boolean; pressAt: number | null;
}
export type ComboEvent =
  | { type: "start"; trick: Trick; from: Slot; to: Slot; quality: Quality; chain: number; mult: number }
  | { type: "press"; trick: Trick; quality: Quality }
  | { type: "land"; trick: Trick; chain: number; pts: number; repeat: boolean; mult: number; prevId: string | null }
  | { type: "end"; chain: number; bonus: number; comboScore: number; perfects: number }
  | { type: "drop"; reason: "early" | "slot"; chain: number; lost: number; comboScore: number; perfects: number; trick?: Trick; slot?: Slot }
  | { type: "rejected"; trick: Trick; slot: Slot }
  | { type: "ready" };

export class SpinCombo {
  state: "idle" | "spin" | "drop" = "idle";
  slot: Slot = "12";            // gap the pen is held in (when not spinning)
  dropUntil = 0;
  score = 0;                    // session total
  cur: Cur | null = null;       // trick in the air (or just caught, window still open)
  next: { trick: Trick; quality: Quality } | null = null;   // pressed early in the window, starts at the catch
  chain = 0;
  mult = 1;
  comboScore = 0;
  perfects = 0;
  last: string | null = null;   // previous trick (repeat penalty)

  constructor(private emit: (e: ComboEvent) => void = () => {}) {}

  resetCombo() {
    this.cur = null; this.next = null; this.chain = 0; this.mult = 1; this.comboScore = 0; this.perfects = 0; this.last = null;
  }

  // ---- tuning ----
  speed(chain: number) { return Math.min(MAX_SPEED, 1 + 0.045 * chain); }
  durFor(trick: Trick, chain: number) { return trick.ms / this.speed(chain); }
  timing(chain: number) {       // ms around the catch
    return { pre: Math.max(140, 260 - chain * 6), post: Math.max(150, 420 - chain * 14), gold: Math.max(40, 95 - chain * 3) };
  }
  bonus() { return Math.round(this.chain * this.chain * BONUS_PER_LINK2 * this.mult); }

  /** Move the resting pen to another gap (only between combos). */
  setSlot(slot: Slot) { if (this.state === "idle") this.slot = slot; }
  /** Gap the next trick would start from. */
  nextSlot(): Slot { return this.cur ? this.cur.to : this.slot; }

  /** Timing bar for the UI: fractions of the bar [t0 .. window end]. */
  bar(now: number) {
    const c = this.cur;
    if (!c || this.state !== "spin") return null;
    const span = c.winEnd - c.t0, f = (x: number) => (x - c.t0) / span;
    return { needle: Math.min(1, f(now)), win: f(c.winStart), gold0: f(c.goldStart), gold1: f(c.goldEnd), press: c.pressAt ? f(c.pressAt) : null };
  }

  // ---- input ----
  press(trick: Trick, now: number) {
    this.update(now);                                           // land / end anything due before this press
    if (this.state === "drop") return;
    if (this.state === "idle") {
      if (!trick.moves[this.slot]) return this.emit({ type: "rejected", trick, slot: this.slot });
      return this.start(trick, now, "start");
    }
    const c = this.cur!;
    if (this.next || c.pressAt) return;                         // one press per link
    if (now < c.winStart) return this.drop("early", now);
    if (!trick.moves[c.to]) return this.drop("slot", now, { trick, slot: c.to });
    const quality: Quality = now >= c.goldStart && now <= c.goldEnd ? "perfect" : "good";
    c.pressAt = now;
    this.emit({ type: "press", trick, quality });
    if (now < c.catchAt) this.next = { trick, quality };        // still in the air: starts on the catch
    else this.start(trick, now, quality);
  }

  // ---- time ----
  update(now: number) {
    if (this.state === "drop") {
      if (now >= this.dropUntil) { this.state = "idle"; this.slot = "12"; this.cur = null; this.emit({ type: "ready" }); }
      return;
    }
    if (this.state !== "spin") return;
    const c = this.cur!;
    if (!c.landed && now >= c.catchAt) {
      c.landed = true;
      this.slot = c.to;
      this.chain++;
      const repeat = this.last === c.trick.id, prevId = this.last;
      const pts = Math.round(c.trick.pts * this.mult * (repeat ? REPEAT_FACTOR : 1));
      this.comboScore += pts; this.score += pts; this.last = c.trick.id;
      this.emit({ type: "land", trick: c.trick, chain: this.chain, pts, repeat, mult: this.mult, prevId });
      if (this.next) { const n = this.next; this.next = null; this.start(n.trick, c.catchAt, n.quality); return; }
    }
    if (c.landed && now >= c.winEnd) {
      const bonus = this.bonus();
      this.score += bonus;
      this.emit({ type: "end", chain: this.chain, bonus, comboScore: this.comboScore + bonus, perfects: this.perfects });
      this.state = "idle";
      this.resetCombo();
    }
  }

  private start(trick: Trick, now: number, quality: Quality) {
    if (quality === "start") this.resetCombo();
    if (quality === "perfect") { this.mult = Math.min(MAX_MULT, this.mult + PERFECT_GAIN); this.perfects++; }
    const from = this.slot, to = trick.moves[from]!, dur = this.durFor(trick, this.chain), tm = this.timing(this.chain), catchAt = now + dur;
    this.cur = { trick, from, to, t0: now, dur, catchAt, winStart: catchAt - Math.min(tm.pre, dur * 0.6),
      winEnd: catchAt + tm.post, goldStart: catchAt - tm.gold * 0.5, goldEnd: catchAt + tm.gold, landed: false, pressAt: null };
    this.state = "spin";
    this.emit({ type: "start", trick, from, to, quality, chain: this.chain, mult: this.mult });
  }

  private drop(reason: "early" | "slot", now: number, extra: { trick?: Trick; slot?: Slot } = {}) {
    this.emit({ type: "drop", reason, chain: this.chain, lost: this.bonus(), comboScore: this.comboScore, perfects: this.perfects, ...extra });
    this.state = "drop";
    this.dropUntil = now + DROP_MS;
    this.resetCombo();
  }
}
