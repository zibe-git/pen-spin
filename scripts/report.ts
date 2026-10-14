/* Web vitals report: Lighthouse on the production build (mobile + desktop), plus a user flow that plays the game
 * (menu tap, intro, a run of SPIN taps) to measure Interaction to Next Paint, which a page load can't show.
 *   bun scripts/report.ts            writes reports/lighthouse-*.html, reports/flow.html and reports/vitals.md
 */
import lighthouse, { desktopConfig, startFlow } from "lighthouse";
import puppeteer, { type Page } from "puppeteer-core";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromePath } from "./chrome";

const OUT = join(import.meta.dir, "..", "reports");
mkdirSync(OUT, { recursive: true });
const { server } = await import("./serve");
const url = `http://localhost:${server.port}/`;
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--enable-unsafe-swiftshader"] });

type LHR = { categories: Record<string, { score: number | null }>; audits: Record<string, { numericValue?: number; displayValue?: string; score?: number | null }> };
const rows: string[] = [];
const ms = (v?: number) => (v === undefined ? "–" : v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(2)} s`);
const kb = (v?: number) => (v === undefined ? "–" : `${(v / 1024).toFixed(1)} KB`);

async function run(name: string, config?: object) {
  const page = await browser.newPage();
  const r = await lighthouse(url, { output: ["html", "json"], logLevel: "error" }, config as never, page as never);
  await page.close();
  if (!r) throw new Error("no lighthouse result");
  writeFileSync(join(OUT, `lighthouse-${name}.html`), r.report[0] as string);
  const lhr = r.lhr as unknown as LHR, a = lhr.audits, c = lhr.categories;
  const s = (k: string) => Math.round((c[k]?.score ?? 0) * 100);
  rows.push(`| ${name} | ${s("performance")} | ${s("accessibility")} | ${s("best-practices")} | ${s("seo")} | ${ms(a["first-contentful-paint"]?.numericValue)} | ${ms(a["largest-contentful-paint"]?.numericValue)} | ${ms(a["total-blocking-time"]?.numericValue)} | ${(a["cumulative-layout-shift"]?.numericValue ?? 0).toFixed(3)} | ${ms(a["speed-index"]?.numericValue)} | ${kb(a["total-byte-weight"]?.numericValue)} |`);
  const fails = Object.entries(a).filter(([, v]) => v.score !== null && v.score !== undefined && v.score < 0.9).map(([k, v]) => `${k}${v.displayValue ? ` (${v.displayValue})` : ""}`);
  return fails;
}

/** Plays the game the way a person would, through its real UI. */
async function play(page: Page) {
  await page.click('[data-go="flow"]');
  await page.waitForSelector("#dHow[open]");
  await page.click("#dHow [data-close]");
  await page.click("#spin");
  const t0 = Date.now();
  let taps = 1;
  while (Date.now() - t0 < 8000 && taps < 14) {
    const cls = await page.$eval("#spin", (b) => b.className);
    if (/\b(gold|go)\b/.test(cls)) { await page.click("#spin"); taps++; }
    else if (/\bidle\b/.test(cls)) { await page.click("#spin"); taps++; }
    await new Promise((r) => setTimeout(r, 15));
  }
  await page.click("#bPause");
  await page.click("#bQuit");
  return taps;
}

const mobileFails = await run("mobile");
const desktopFails = await run("desktop", desktopConfig);

const page = await browser.newPage();
const flow = await startFlow(page as never, { name: "Pen Spin: load and play" });
await flow.navigate(url);
await flow.startTimespan({ name: "Play a combo" });
const taps = await play(page);
await flow.endTimespan();
writeFileSync(join(OUT, "flow.html"), await flow.generateReport());
const fr = await flow.createFlowResult();
const span = fr.steps.find((s) => s.lhr.gatherMode === "timespan")!.lhr as unknown as LHR;
const inp = span.audits["interaction-to-next-paint"]?.numericValue, tbtSpan = span.audits["total-blocking-time"]?.numericValue;
const clsSpan = span.audits["cumulative-layout-shift"]?.numericValue;
await browser.close();
server.stop();

const dist = join(import.meta.dir, "..", "dist"), size = (f: string) => statSync(join(dist, f)).size;
const md = `# Pen Spin: web vitals report

Generated ${new Date().toISOString()} by \`bun run report\` (Lighthouse, headless Chrome, production build served with brotli).

## Lighthouse (page load)

| run | perf | a11y | best practices | SEO | FCP | LCP | TBT | CLS | Speed Index | transfer |
|---|---|---|---|---|---|---|---|---|---|---|
${rows.join("\n")}

Mobile is Lighthouse's default: a mid-range phone, slow 4G, 4x CPU slowdown (simulated).

## Playing (user flow, ${taps} taps on the SPIN button)

| metric | value |
|---|---|
| INP (Interaction to Next Paint) | ${ms(inp)} |
| TBT while playing | ${ms(tbtSpan)} |
| CLS while playing | ${(clsSpan ?? 0).toFixed(3)} |

## Footprint

| file | raw | brotli |
|---|---|---|
${["index.html", "sw.js", "manifest.webmanifest", "icon.svg"].map((f) => `| ${f} | ${kb(size(f))} | ${kb(size(f + ".br"))} |`).join("\n")}

The whole game (JS, CSS, GLSL, trick data) is the one \`index.html\`. No images, fonts, or libraries.
${mobileFails.length || desktopFails.length ? `\n## Audits under 90\n\n- mobile: ${mobileFails.join(", ") || "none"}\n- desktop: ${desktopFails.join(", ") || "none"}\n` : ""}
Full reports: [mobile](lighthouse-mobile.html) · [desktop](lighthouse-desktop.html) · [user flow](flow.html)
`;
writeFileSync(join(OUT, "vitals.md"), md);
console.log(md);
