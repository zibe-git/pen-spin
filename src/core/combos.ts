/* Real pen spinning combos, as broken down in the sources of the original catalog (penspinningcentral,
 * chrisjet98, vonguru's BanZ WT07 breakdown, penstock, penspinning.org, Wikipedia), in this game's slots.
 * Every step starts in the slot the previous one ended in; the tests check it. Ordered easiest first:
 * this is the Combo Ladder, each one unlocks the next. */
import type { Slot } from "./tricks";

export interface Combo { id: string; name: string; start: Slot; steps: string[]; western: string }
export const COMBOS: Combo[] = [
  { id: "sonicrise", name: "Sonic Rise", start: "45", steps: ["sonic", "sonic"], western: "Sonic 43-32 > Sonic 32-21" },
  { id: "sonicfall", name: "Sonic Fall", start: "23", steps: ["sonicr", "sonicr"], western: "Sonic Rev 12-23 > Sonic Rev 23-34" },
  { id: "exta", name: "Extended ThumbAround", start: "12", steps: ["ta", "ia"], western: "Thumbaround > Index around" },
  { id: "tsbust", name: "Twisted Sonic Bust", start: "34", steps: ["tsonic", "bust"], western: "Twisted Sonic 23-12 > Index Backaround Reverse" },
  { id: "tsneo", name: "Twisted Sonic > NeoSonic", start: "34", steps: ["tsonic", "neo"], western: "Twisted Sonic > Neo Sonic" },
  { id: "pdts_ta", name: "Twisted Sonic > ThumbAround", start: "34", steps: ["tsonic", "ta"], western: "PD Twisted Sonic 32-21 > Thumbaround" },
  { id: "dcharge", name: "Double Charge", start: "34", steps: ["tsonic", "pass"], western: "Twisted Sonic 23-12 > Pass 12-34" },
  { id: "infia", name: "Infinity > Indexaround", start: "12", steps: ["inf", "ia"], western: "Infinity > Index around" },
  { id: "kam", name: "Kam's 4 Loop", start: "45", steps: ["sonic", "tsonic", "ta15"], western: "Sonic 34-23 > Twisted Sonic 23-12 > Thumbaround 1.5 12-T12" },
  { id: "pdts_sh", name: "Twisted Sonic > Shadow", start: "34", steps: ["tsonic", "shadow"], western: "PD Twisted Sonic 32-21 > Shadow" },
  { id: "demonia", name: "Demon's Sonic > Indexaround", start: "45", steps: ["sonic", "passr", "ia"], western: "Sonic 43-42 > Pass Rev 42-21 > Index around" },
  { id: "rfans", name: "Rising Fans", start: "45", steps: ["charge", "sonic", "charge", "sonic", "charge"], western: "Charge 43 > Sonic 43-32 > Charge 32 > Sonic 32-21 > Charge 21" },
  { id: "ffans", name: "Falling Fans", start: "23", steps: ["charger", "sonicr", "charger", "sonicr", "charger"], western: "Charge Rev 12 > Sonic Rev 12-23 > Charge Rev 23 > Sonic Rev 23-34 > Charge Rev 34" },
  { id: "basics", name: "The 4 Basics", start: "34", steps: ["charge", "sonic", "passr", "ta", "fpass"], western: "Charge, Sonic, ThumbAround, FingerPass" },
  { id: "beginner", name: "Beginner Chain", start: "34", steps: ["tsonic", "passrd", "tsonicr", "passu", "sonic", "ta"], western: "Twisted Sonic > Pass Rev 12-23 > Twisted Sonic Rev 23-34 > Pass 34-23 > Sonic 23-12 > Thumbaround" },
  { id: "banz", name: "BanZ WT07 Finale", start: "34", steps: ["charge", "wiperr", "pass", "passu", "tsonic", "passr", "ta"], western: "Charge 23 > Wiper Rev 23 > Pass 23-34 > Pass 34-23 > Twisted Sonic 23-12 > Pass Rev 12-T1 > Thumbaround" },
];

/** How often each "a>b" link appears in the real combos: Flow and Endless prefer these. */
export const LINKS: Record<string, number> = {};
for (const c of COMBOS) for (let i = 1; i < c.steps.length; i++) { const k = c.steps[i - 1] + ">" + c.steps[i]; LINKS[k] = (LINKS[k] || 0) + 1; }

/** Stars for a combo run: 1 = landed every link, 2 = at least half PERFECT, 3 = all PERFECT. */
export function stars(links: number, perfects: number) {
  const linked = Math.max(1, links - 1);            // the opener can't be perfect
  return perfects >= linked ? 3 : perfects * 2 >= linked ? 2 : 1;
}
