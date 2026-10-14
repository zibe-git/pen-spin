/* Pen Spin: the game around SpinCombo (timing); the 3D stage (hand rig + renderer, stage.ts) runs in a worker.
 *
 * One button. While the pen spins the button waits; when the timing bar's needle reaches the window it lights
 * up (blue), gold in the PERFECT zone. Tap it to link the next trick.
 *   Flow     WHEN you tap picks the next trick: early / perfect / late lead to different connected tricks.
 *   Endless  the game picks a connected next trick, you only time it.
 *   Combos   a ladder of real, documented combos; each one unlocks the next and earns up to 3 stars.
 * Landing tricks fills the Trick Book; milestones unlock pens.
 */
import { SpinCombo, type ComboEvent, type Cur } from "./core/combo";
import { COMBOS, LINKS, stars as starsFor } from "./core/combos";
import { BYID, FAMILIES, TRICKS, type Slot, type Trick, slotLabel, howTo, videoFor } from "./core/tricks";
import { load, save, wipe } from "./ui/store";
import { fx, sfx, unlock, buzz, ctx } from "./ui/audio";
import { bindOrbit, CAMERAS } from "./gfx/camera";
import { type FromStage, type Snap, type ToStage, createStage } from "./stage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
type Mode = "flow" | "endless" | "ladder";

let S = load();
const MOVES = TRICKS.filter((t) => t.family !== "Linkages" && t.segs.length <= 2);   // single moves for Flow / Endless
const PENS = [
  { c: "#e8453c", name: "Classic", need: "" },
  { c: "#3d8bfd", name: "Ocean", need: "Land 25 tricks" },
  { c: "#7bd13a", name: "Lime", need: "10 in a row" },
  { c: "#a26bff", name: "Violet", need: "Earn 10 stars" },
  { c: "#20c5b5", name: "Teal", need: "25 in a row" },
  { c: "#f5b83d", name: "Gold", need: "Earn 30 stars" },
  { c: "#e9edf2", name: "Pearl", need: "Learn 40 tricks" },
];
const totalLanded = () => Object.values(S.landed).reduce((a, b) => a + b, 0);
const learned = () => Object.keys(S.landed).filter((id) => BYID[id]).length;
const totalStars = () => Object.values(S.stars).reduce((a, b) => a + b, 0);
const penOk = (i: number) => [true, totalLanded() >= 25, S.maxStreak >= 10, totalStars() >= 10, S.maxStreak >= 25, totalStars() >= 30, learned() >= 40][i]!;
const sl = (s: Slot) => slotLabel(s, S.western);

// ------------------------------------------------------------- game clock --
// Practice runs it slower (tricks, windows and the falling pen alike); pause stops it.
let rate = 1, clockBase = 0, perfBase = 0, practice = false;
const clock = () => clockBase + (performance.now() - perfBase) * rate;
const clockAt = (perfT: number) => clockBase + (perfT - perfBase) * rate;
function setRate(r: number) { clockBase = clock(); perfBase = performance.now(); rate = r; send({ t: "clock", base: clockBase, perfBase, rate }); }

// ------------------------------------------------------------- 3D stage --
let send: (m: ToStage, transfer?: Transferable[]) => void = () => {};
let lastSnap = "";
/** Tell the stage about the combo whenever it changes (it animates the pen from that and the clock). */
function syncStage() {
  const c = combo, cur = c.cur;
  const snap: Snap = { state: c.state, slot: c.slot, cur: cur && { id: cur.trick.id, from: cur.from, to: cur.to, t0: cur.t0, dur: cur.dur, catchAt: cur.catchAt, landed: cur.landed },
    next: c.next && { id: c.next.trick.id, dur: c.durFor(c.next.trick, c.chain + 1) } };
  const key = JSON.stringify(snap);
  if (key !== lastSnap) { lastSnap = key; send({ t: "combo", snap }); }
}

// ------------------------------------------------------------------ state --
let combo = new SpinCombo(onEvent), mode: Mode = "endless", ladderIdx = 0, comboStep = -1, bot = true, playing = false;
let plan: { branches?: { early: Trick; perfect: Trick; late: Trick } | null; next?: Trick | null } | null = null;

// ------------------------------------------------- one-button planning ----
function pick<T>(list: T[], weight: (t: T) => number) {
  const w = list.map(weight);
  let r = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < list.length; i++) { r -= w[i]!; if (r <= 0) return list[i]!; }
  return list[list.length - 1]!;
}
const linkScore = (prev: string | null, t: Trick) => (prev ? LINKS[prev + ">" + t.id] || 0 : 0);
const candidates = (slot: Slot, prev: string | null) => MOVES.filter((t) => t.moves[slot] && t.id !== prev);
function flowBranches(slot: Slot, prev: string | null) {
  const c = candidates(slot, prev);
  if (!c.length) return null;
  const sorted = c.slice().sort((a, b) => linkScore(prev, b) - linkScore(prev, a) || Math.random() - 0.5);
  const perfect = linkScore(prev, sorted[0]!) > 0 ? sorted[0]! : pick(c, (t) => t.pts);
  const rest = c.filter((t) => t !== perfect), early = rest.length ? pick(rest, () => 1) : perfect;
  const rest2 = rest.filter((t) => t !== early), late = rest2.length ? pick(rest2, () => 1) : early;
  return { early, perfect, late };
}
function endlessNext(slot: Slot, prev: string | null) {
  const c = candidates(slot, prev);
  return c.length ? pick(c, (t) => 1 + 3 * linkScore(prev, t)) : null;
}
const ladder = () => COMBOS[ladderIdx]!;
function replan(slot: Slot, prev: string | null) {
  if (mode === "flow" && !bot) plan = { branches: flowBranches(slot, prev) };
  else if (mode === "ladder") plan = { next: BYID[ladder().steps[comboStep + 1]!] || null };
  else plan = { next: endlessNext(slot, prev) };
  renderSteps();
}
/** Which Flow branch a tap at game time t picks. */
const zoneAt = (c: Cur, t: number) => (t < c.goldStart ? "early" : t <= c.goldEnd ? "perfect" : "late");

/** The button. t = game time of the tap (the input event's own timestamp, minus the latency offset). */
function spinKey(t: number) {
  combo.update(clock());
  if (combo.state === "drop") return;
  if (combo.state === "idle") {
    if (mode === "ladder") { comboStep = -1; return press(BYID[ladder().steps[0]!]!, t); }
    const opener = mode === "flow" && !bot ? flowBranches(combo.slot, null)?.perfect : endlessNext(combo.slot, null);
    if (opener) press(opener, t);
    return;
  }
  const tr = plan?.branches ? plan.branches[zoneAt(combo.cur!, t)] : plan?.next;
  if (tr) press(tr, t);
  else if (mode === "ladder") pop("Last link", "small", "let the needle run out to finish");
}
const press = (tr: Trick, t: number) => combo.press(tr, Math.min(t, clock()));

// ----------------------------------------------------------------- HUD ----
function pop(text: string, cls = "", sub = "") {
  if (bot) return;
  const lane = cls.includes("small") ? "s" : "m", box = $("pops");
  box.querySelector(`[data-l="${lane}"]`)?.remove();
  const el = document.createElement("div");
  el.dataset.l = lane; el.className = "pop " + cls;
  el.innerHTML = `<b>${esc(text)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
const bump = (el: HTMLElement) => el.animate([{ transform: "scale(1.3)" }, { transform: "none" }], { duration: 250, easing: "ease-out" });
/** Run after the next frame is painted: keeps taps fast (INP) by moving non-urgent work out of them. */
const afterPaint = (f: () => void) => requestAnimationFrame(() => setTimeout(f));
/** Write text only when it changed: an unchanged write still costs a layout. */
const setText = (el: HTMLElement, s: string) => { if (el.textContent !== s) el.textContent = s; };
let toastT = 0;
function toast(msg: string) {
  const t = $("toast");
  t.textContent = msg; t.classList.add("on");
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("on"), 2600) as unknown as number;
}

function renderSteps() {
  if (bot) return;
  const box = $("steps");
  if (mode === "ladder") {
    box.className = "steps chips";
    box.innerHTML = ladder().steps.map((id, i) => `<span class="ch${i === comboStep ? " now" : i < comboStep ? " done" : ""}">${esc(BYID[id]!.name)}</span>`).join("");
    box.querySelector(".now")?.scrollIntoView({ inline: "center", block: "nearest" });
  } else if (mode === "flow") {
    const br = combo.state === "spin" ? plan?.branches : null;
    box.className = "steps";
    box.innerHTML = (["early", "perfect", "late"] as const).map((z) => `<div class="br ${z}" data-z="${z}"><small>${z}</small>${br ? esc(br[z].name) : "–"}</div>`).join("");
  } else {
    const nx = combo.state === "spin" ? plan?.next : null;
    box.className = "steps chips";
    box.innerHTML = `<span class="ch">${nx ? "next: " + esc(nx.name) : "the game picks the next trick: just time it"}</span>`;
  }
}

const ui = {} as Record<string, HTMLElement>;
let lastBtn = "", lastHud = "";
const sx = (el: HTMLElement, a: number, b: number) => { el.style.transform = `translateX(${(a * 100).toFixed(2)}%) scaleX(${Math.max(0, b - a).toFixed(4)})`; };
const tx = (el: HTMLElement, a: number) => { el.style.transform = `translateX(${(Math.max(0, Math.min(1, a)) * 100).toFixed(2)}%)`; };
function updateHud(now: number) {
  const c = combo, hud = c.chain + "|" + c.comboScore + "|" + c.mult;
  if (hud !== lastHud) {
    if (!lastHud.startsWith(c.chain + "|")) bump(ui.streak!);
    lastHud = hud;
    ui.streak!.textContent = String(c.chain);
    ui.score!.textContent = c.comboScore.toLocaleString();
    ui.mult!.textContent = "x" + c.mult.toFixed(1);
  }
  const bar = c.bar(now);
  ui.tbar!.classList.toggle("live", !!bar);
  let state = "idle", label = "SPIN", sub = mode === "ladder" ? ladder().name : "tap to start";
  if (c.state === "drop") { state = "drop"; label = "DROPPED"; sub = "picking it up…"; }
  else if (bar && c.cur) {
    const cur = c.cur, t = now - S.offset * rate;
    sx(ui.tWin!, bar.win, 1); sx(ui.tGold!, bar.gold0, bar.gold1); tx(ui.tNeedle!, bar.needle);
    if (ui.tPress!.hidden !== (bar.press === null)) ui.tPress!.hidden = bar.press === null;
    if (bar.press !== null) tx(ui.tPress!, bar.press);
    setText(ui.trick!, cur.trick.name);
    setText(ui.slot!, `${sl(cur.from)} → ${sl(cur.to)}`);
    const zone = zoneAt(cur, t), next = plan?.branches ? plan.branches[zone] : plan?.next;
    if (cur.pressAt || c.next) { state = "linked"; label = "LINKED"; sub = c.next?.trick.name || "nice"; }
    else if (t < cur.winStart) { state = "wait"; label = "wait…"; sub = "tap when it lights up"; }
    else { state = zone === "perfect" ? "gold" : "go"; label = zone === "perfect" ? "PERFECT" : "TAP"; sub = next ? next.name : mode === "ladder" ? "last link: let it run out" : ""; }
    for (const el of ui.steps!.querySelectorAll<HTMLElement>(".br")) el.classList.toggle("on", (state === "go" || state === "gold") && el.dataset.z === zone);
  } else if (c.state === "idle") {
    setText(ui.trick!, mode === "ladder" ? ladder().name : "Ready");
    setText(ui.slot!, `pen in gap ${sl(c.slot)}`);
  }
  const key = state + label + sub;
  if (key !== lastBtn) {                         // touch the DOM only when the button changes
    lastBtn = key;
    ui.spin!.className = "spin " + state;
    ui.spinL!.textContent = label;
    ui.spinS!.textContent = sub;
  }
}

// ---------------------------------------------------------- game events ----
function onEvent(e: ComboEvent) {
  if (e.type === "start") {
    if (mode === "ladder" && !bot) { const i = ladder().steps.indexOf(e.trick.id, comboStep + 1); comboStep = i < 0 ? 0 : i; }
    replan(e.to, e.trick.id);
    if (bot) return;
    if (e.quality === "perfect") { pop("PERFECT", "gold", `x${e.mult.toFixed(1)}`); sfx.perfect(); }
    else if (e.quality === "good") { pop("GOOD", "blue"); sfx.good(); }
  } else if (e.type === "land") {
    if (bot) return;
    sfx.catch(e.chain);
    pop(`+${e.pts}`, "small", e.repeat ? "repeat: half points" : e.trick.name);
    if (LINKS[e.prevId + ">" + e.trick.id]) sfx.link();
    const first = !S.landed[e.trick.id];
    S.landed[e.trick.id] = (S.landed[e.trick.id] || 0) + 1;
    if (first && !practice) toast(`New in the Trick Book: ${e.trick.name}`);
    if (e.chain > S.maxStreak && !practice) S.maxStreak = e.chain;
    checkPens(); save(S);
  } else if (e.type === "end") {
    if (bot) return;
    sfx.end(e.chain);
    const done = mode === "ladder" && comboStep === ladder().steps.length - 1;
    if (mode === "ladder") ladderResult(done, e.perfects, done ? "" : `Stopped after ${comboStep + 1} of ${ladder().steps.length} links`);
    else pop(`${e.chain} IN A ROW`, "big", `+${e.bonus.toLocaleString()} bonus · ${e.comboScore.toLocaleString()} pts`);
    record(e.chain, e.comboScore);
    comboStep = -1;
    afterCombo();
  } else if (e.type === "drop") {
    if (bot) return;
    sfx.drop();
    const why = e.reason === "slot" ? `${e.trick!.name} can't start from gap ${sl(e.slot!)}` : "tapped before it lit up";
    pop(e.reason === "early" ? "Too early!" : "DROP!", "red", `${why}${e.lost ? ` · lost ${e.lost.toLocaleString()} bonus` : ""}`);
    record(e.chain, e.comboScore);
    if (mode === "ladder") setTimeout(() => ladderResult(false, 0, "The pen dropped: " + why), 900);
    comboStep = -1;
  } else if (e.type === "ready") afterCombo();
}
/** Between combos: Combos mode puts the pen back where the combo starts. */
function afterCombo() {
  if (mode === "ladder" && combo.state === "idle" && combo.slot !== ladder().start) { combo.setSlot(ladder().start); send({ t: "glide" }); }
  replan(combo.slot, null);
}

function record(streak: number, score: number) {
  if (practice || mode === "ladder") return;
  const b = S.best[mode] ||= { streak: 0, score: 0 };
  if (streak > b.streak) { b.streak = streak; if (streak > 2) pop("NEW BEST", "gold", `${streak} in a row`); }
  if (score > b.score) b.score = score;
  save(S);
}
let pensKnown = PENS.map((_, i) => penOk(i));
function checkPens() {
  PENS.forEach((p, i) => { if (penOk(i) && !pensKnown[i]) { toast(`New pen unlocked: ${p.name}`); sfx.unlock(); } });
  pensKnown = PENS.map((_, i) => penOk(i));
}

function ladderResult(ok: boolean, perfects: number, why: string) {
  const cb = ladder();
  let n = 0;
  if (ok && !practice) {
    n = starsFor(cb.steps.length, perfects);
    if (n > (S.stars[cb.id] || 0)) S.stars[cb.id] = n;
    checkPens(); save(S);
  }
  $("tResult").textContent = ok ? (practice ? "Landed (practice)" : cb.name) : "Not quite";
  $("rStars").textContent = ok && !practice ? "★".repeat(n) + "☆".repeat(3 - n) : "";
  $("rSub").textContent = ok ? (n < 3 && !practice ? `${perfects} PERFECT link${perfects === 1 ? "" : "s"}: hit them all for 3 stars.` : "Clean.") : why;
  const nextOk = ladderIdx + 1 < COMBOS.length && !!S.stars[cb.id];
  $("rNext").hidden = !nextOk;
  openDlg("dResult");
}

// ------------------------------------------------------------- screens ----
function startPlay(m: Mode, idx = 0) {
  mode = m; ladderIdx = idx; bot = false; playing = true; comboStep = -1;
  combo = new SpinCombo(onEvent);
  lastBtn = lastHud = "";
  if (m === "ladder") { combo.setSlot(ladder().start); send({ t: "glide" }); }
  replan(combo.slot, null);
  $("home").hidden = true; $("play").hidden = false;
  send({ t: "shift", v: 0.34 });
  if (!S.intro) { S.intro = true; save(S); afterPaint(() => openDlg("dHow")); }
}
function goHome() {
  closeDlgs();
  if (practice) { practice = false; ($("oPractice") as HTMLInputElement).checked = false; }
  setRate(1);
  mode = "endless"; bot = true; playing = false;
  combo = new SpinCombo(onEvent);
  $("play").hidden = true; $("home").hidden = false;
  send({ t: "shift", v: 0.1 });
  renderHome();
}
function renderHome() {
  const n = TRICKS.length, st = totalStars();
  $("hStars").textContent = `${st} / ${COMBOS.length * 3} ★`;
  $("hEndless").textContent = `best ${S.best.endless?.streak || 0} in a row`;
  $("hBook").textContent = `${learned()} / ${n} learned`;
}

// ------------------------------------------------------------- dialogs ----
const dlg = (id: string) => $(id) as HTMLDialogElement;
function openDlg(id: string) { const d = dlg(id); if (!d.open) d.showModal(); }
function closeDlgs() { for (const d of document.querySelectorAll("dialog")) if (d.open) d.close(); }
function pause() {
  if (!playing || dlg("dPause").open) return;
  setRate(0);
  openDlg("dPause");
}
function resume() { dlg("dPause").close(); }

function renderLadder() {
  $("ladder").innerHTML = COMBOS.map((c, i) => {
    const s = S.stars[c.id] || 0, open = i === 0 || !!S.stars[COMBOS[i - 1]!.id];
    return `<li><button class="lv" data-i="${i}"${open ? "" : " disabled"}><span class="n">${open ? i + 1 : "🔒"}</span>`
      + `<span><b>${esc(c.name)}</b><small>${c.steps.map((id) => esc(BYID[id]!.name)).join(" › ")}</small></span>`
      + `<span class="s" aria-label="${s} stars">${"★".repeat(s)}${"☆".repeat(3 - s)}</span></button></li>`;
  }).join("");
}
function renderBook() {
  const n = TRICKS.length, got = learned();
  $("bookBar").style.transform = `scaleX(${got / n})`;
  $("bookSub").textContent = `${got} of ${n} tricks landed · ${totalLanded().toLocaleString()} catches in total. Tap a trick for how to do it for real.`;
  $("book").innerHTML = FAMILIES.map((f) => `<h3>${f}</h3>` + TRICKS.filter((t) => t.family === f).map((t) => {
    const k = S.landed[t.id] || 0;
    return `<details class="${k ? "got" : ""}"><summary><b>${esc(t.name)}</b><small>${k ? "×" + k : "not landed yet"} · ${t.pts} pts</small></summary>`
      + `<div><p>${esc(t.about)}.</p><ol>${howTo(t).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`
      + `<a href="${videoFor(t)}" target="_blank" rel="noopener">Watch a tutorial ↗</a></div></details>`;
  }).join("")).join("");
}
function renderSettings() {
  $("pens").innerHTML = PENS.map((p, i) => `<button style="background:${p.c}" data-c="${p.c}" class="${S.pen === p.c ? "on" : ""}"${penOk(i) ? "" : " disabled"} aria-label="${p.name}${penOk(i) ? "" : ": " + p.need}" title="${p.name}${penOk(i) ? "" : " · " + p.need}"></button>`).join("");
  for (const b of $("oHand").children) b.classList.toggle("on", (b as HTMLElement).dataset.v === S.hand);
  ($("oSound") as HTMLInputElement).checked = S.sound;
  ($("oHaptics") as HTMLInputElement).checked = S.haptics;
  ($("oWestern") as HTMLInputElement).checked = S.western;
  ($("oOff") as HTMLInputElement).value = String(S.offset);
  $("oOffOut").textContent = `${S.offset > 0 ? "+" : ""}${S.offset} ms`;
}
function applySettings() {
  fx.sound = S.sound; fx.haptics = S.haptics;
  send({ t: "pen", c: S.pen });
  send({ t: "side", side: S.hand === "left" ? -1 : 1 });
}

// tap-along calibration: 8 beats from the audio clock, the median tap error becomes the offset
let calib: { beats: number[]; taps: number[] } | null = null;
function calibrate() {
  unlock();
  const ac = ctx();
  if (!ac) { $("calibOut").textContent = fx.sound ? "Starting audio… tap again." : "Turn sound on to calibrate."; return; }
  const t0 = ac.currentTime + 0.8, ts = ac.getOutputTimestamp ? ac.getOutputTimestamp() : null;
  const toPerf = (at: number) => ts && ts.performanceTime ? ts.performanceTime + (at - ts.contextTime!) * 1000 : performance.now() + (at - ac.currentTime + (ac.outputLatency || 0)) * 1000;
  calib = { beats: [], taps: [] };
  for (let i = 0; i < 8; i++) {
    const at = t0 + i * 0.6;
    sfx.beat(at - ac.currentTime);
    calib.beats.push(toPerf(at));
    setTimeout(() => { $("padN").textContent = String(i + 1); $("pad").classList.add("beat"); setTimeout(() => $("pad").classList.remove("beat"), 90); }, toPerf(at) - performance.now());
  }
  $("calibOut").textContent = "";
  setTimeout(() => {
    const c = calib!, errs = c.taps.map((t) => { const b = c.beats.reduce((x, y) => (Math.abs(y - t) < Math.abs(x - t) ? y : x)); return t - b; }).filter((e) => Math.abs(e) < 280).sort((a, b) => a - b);
    calib = null;
    $("padN").textContent = "Again";
    if (errs.length < 4) { $("calibOut").textContent = "Not enough taps: try again."; return; }
    S.offset = Math.max(-60, Math.min(200, Math.round(errs[errs.length >> 1]! / 5) * 5));
    save(S); renderSettings();
    $("calibOut").textContent = `Your taps land ${S.offset >= 0 ? S.offset + " ms late" : -S.offset + " ms early"}: offset set to ${S.offset} ms.`;
  }, toPerf(t0 + 8 * 0.6) - performance.now() + 400);
}

// ---------------------------------------------------------------- wire ----
function wire() {
  for (const id of ["streak", "score", "mult", "tbar", "tWin", "tGold", "tPress", "tNeedle", "trick", "slot", "steps", "spin", "spinL", "spinS"]) ui[id] = $(id);
  document.addEventListener("click", (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-go],[data-close],.lv,[data-c],[data-v]");
    if (!el) return;
    unlock();
    if (el.dataset.go) {
      const g = el.dataset.go;
      if (g === "flow" || g === "endless") startPlay(g);
      else if (g === "ladder") { renderLadder(); openDlg("dLadder"); }
      else if (g === "book") { renderBook(); openDlg("dBook"); }
      else { renderSettings(); openDlg("dSettings"); }
    } else if (el.hasAttribute("data-close")) (el.closest("dialog") as HTMLDialogElement).close();
    else if (el.classList.contains("lv")) { dlg("dLadder").close(); startPlay("ladder", +el.dataset.i!); }
    else if (el.dataset.c) { S.pen = el.dataset.c; save(S); applySettings(); renderSettings(); }
    else if (el.dataset.v) { S.hand = el.dataset.v as "left" | "right"; save(S); applySettings(); renderSettings(); }
  });
  // the button: pointerdown (no click delay), timed by the event's own timestamp
  ui.spin!.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    unlock();
    spinKey(clockAt(e.timeStamp) - S.offset * rate);
  });
  window.addEventListener("keydown", (e) => {
    if (e.repeat || !playing || document.querySelector("dialog[open]")) return;
    if (e.key === " " || e.key === "Enter") { e.preventDefault(); unlock(); spinKey(clockAt(e.timeStamp) - S.offset * rate); }
    else if (e.key === "Escape") pause();
  });
  $("bPause").onclick = pause;
  dlg("dPause").addEventListener("close", () => { if (playing) setRate(practice ? 0.55 : 1); });
  $("bResume").onclick = resume;
  $("bQuit").onclick = goHome;
  $("bHow").onclick = () => { resume(); openDlg("dHow"); };
  $("oPractice").onchange = (e) => { practice = (e.target as HTMLInputElement).checked; };
  $("bCam").onclick = () => { S.camera = CAMERAS[(CAMERAS.indexOf(S.camera) + 1) % CAMERAS.length]!; send({ t: "cam", preset: S.camera }); save(S); pop(S.camera, "small", "camera"); };
  $("bView").onclick = () => send({ t: "reset" });
  $("rRetry").onclick = () => { dlg("dResult").close(); startPlay("ladder", ladderIdx); };
  $("rNext").onclick = () => { dlg("dResult").close(); startPlay("ladder", ladderIdx + 1); };
  $("oSound").onchange = (e) => { S.sound = (e.target as HTMLInputElement).checked; save(S); applySettings(); unlock(); };
  $("oHaptics").onchange = (e) => { S.haptics = (e.target as HTMLInputElement).checked; save(S); applySettings(); buzz(15); };
  $("oWestern").onchange = (e) => { S.western = (e.target as HTMLInputElement).checked; save(S); };
  $("oOff").oninput = (e) => { S.offset = +(e.target as HTMLInputElement).value; save(S); renderSettings(); };
  $("bCalib").onclick = () => { $("padN").textContent = "Start"; $("calibOut").textContent = ""; openDlg("dCalib"); };
  $("pad").addEventListener("pointerdown", (e) => { if (calib) calib.taps.push(e.timeStamp); else calibrate(); });
  $("bReset").onclick = () => { if (confirm("Reset all progress, stars and unlocked pens?")) { S = wipe(); pensKnown = PENS.map((_, i) => penOk(i)); applySettings(); renderSettings(); renderHome(); } };
  dlg("dSettings").addEventListener("close", renderHome);
  document.addEventListener("visibilitychange", () => { if (document.hidden) pause(); });
}

// ------------------------------------------------------------ the loop ----
let idleSince = 0, botCur: Cur | null = null, botStop = false;

function frame() {
  requestAnimationFrame(frame);
  const now = clock();
  combo.update(now);
  if (bot) runBot(now);
  else updateHud(now);
  syncStage();
}
/** Attract mode on the menu: the game plays itself, always PERFECT, and now and then ends a combo. */
function runBot(now: number) {
  const c = combo;
  if (c.state !== "idle") idleSince = 0;
  else if (!idleSince) idleSince = now;
  else if (now - idleSince > 1100) { idleSince = 0; spinKey(now); }
  if (c.state === "spin" && c.cur && c.cur !== botCur) { botCur = c.cur; botStop = c.chain > 4 && Math.random() < 0.15; }
  if (c.state === "spin" && c.cur && !botStop && !c.cur.pressAt && !c.next && now >= c.cur.goldStart + 8) spinKey(now);
}

function onStage(m: FromStage) {
  if (m.t === "ready") $("cv").classList.add("on");
  else if (m.t === "moved") $("bView").hidden = !m.v;
  else toast(m.msg);
}
/** The 3D stage runs in a worker on an OffscreenCanvas (a second copy of this very script), else in the page. */
function startStage() {
  const cv = $("cv") as HTMLCanvasElement, src = document.querySelector("script[type=module]")?.textContent;
  let canvas: HTMLCanvasElement | OffscreenCanvas = cv;
  try {
    if (!src || !cv.transferControlToOffscreen) throw 0;
    const w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })), { type: "module", name: "stage" });
    w.onmessage = (e: MessageEvent<FromStage>) => onStage(e.data);
    canvas = cv.transferControlToOffscreen();
    send = (m, tr) => w.postMessage(m, tr || []);
  } catch {
    const st = createStage(onStage);
    send = (m) => void st.handle(m);
  }
  send({ t: "init", canvas, w: cv.clientWidth, h: cv.clientHeight, dpr: devicePixelRatio, origin: performance.timeOrigin, pen: S.pen, side: S.hand === "left" ? -1 : 1, camera: S.camera },
    canvas === cv ? [] : [canvas as OffscreenCanvas]);
  send({ t: "clock", base: clockBase, perfBase, rate });
  send({ t: "shift", v: playing ? 0.34 : 0.1 });
  lastSnap = "";
  new ResizeObserver(() => send({ t: "size", w: cv.clientWidth, h: cv.clientHeight, dpr: devicePixelRatio })).observe(cv);
  bindOrbit(cv, send);
}

async function boot() {
  applySettings();
  renderHome();
  wire();
  requestAnimationFrame(frame);
  await new Promise((r) => setTimeout(r, 30));   // the 3D comes in after the first paint: the menu works at once
  startStage();
}

if (typeof document === "undefined") {           // this script, running as the stage worker
  const scope = self as unknown as Worker, st = createStage((m) => scope.postMessage(m));
  scope.onmessage = (e: MessageEvent<ToStage>) => void st.handle(e.data);
} else {
  void boot();
  if ("serviceWorker" in navigator && location.protocol === "https:") addEventListener("load", () => navigator.serviceWorker.register("sw.js"));
}
