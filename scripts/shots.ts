/* Screenshots of the built game in a phone-sized Chrome, playing it through its real UI, and any console errors.
 *   bun scripts/shots.ts [--landscape]     writes reports/shot-*.png
 */
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromePath } from "./chrome";

const OUT = join(import.meta.dir, "..", "reports");
mkdirSync(OUT, { recursive: true });
const { server } = await import("./serve");
const land = process.argv.includes("--landscape");
const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors: string[] = [];
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warn") errors.push(m.type() + ": " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + (e as Error).message));
await page.setViewport(land ? { width: 915, height: 412, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.goto(`http://localhost:${server.port}/`, { waitUntil: "load" });
const sfx = land ? "-land" : "";
await page.waitForSelector("#cv.on", { timeout: 15000 });
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: join(OUT, `shot-home${sfx}.png`) });

await page.click('[data-go="flow"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: join(OUT, `shot-intro${sfx}.png`) });
await page.click("#dHow [data-close]");
// play: tap SPIN, then tap whenever the button turns gold, for a few seconds
await page.keyboard.press("Space");
const t0 = Date.now();
let shot = false;
while (Date.now() - t0 < 9000) {
  const cls = await page.$eval("#spin", (b) => b.className);
  if (cls.includes("gold")) {
    await page.keyboard.press("Space");
    if (!shot && Date.now() - t0 > 3000) { await new Promise((r) => setTimeout(r, 120)); await page.screenshot({ path: join(OUT, `shot-play${sfx}.png`) }); shot = true; }
  }
  await new Promise((r) => setTimeout(r, 8));
}
await page.screenshot({ path: join(OUT, `shot-play2${sfx}.png`) });
if (process.argv.includes("--cams")) for (let i = 1; i <= 4; i++) {
  await page.click("#bCam");
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: join(OUT, `shot-cam${i}${sfx}.png`) });
}
await page.click("#bPause");
await page.click("#bQuit");
await page.click('[data-go="ladder"]');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: join(OUT, `shot-ladder${sfx}.png`) });
await page.keyboard.press("Escape");
await page.click('[data-go="book"]');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: join(OUT, `shot-book${sfx}.png`) });
await page.keyboard.press("Escape");
await page.click('[data-go="settings"]');
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: join(OUT, `shot-settings${sfx}.png`) });
const streak = await page.$eval("#hEndless", (e) => e.textContent);
console.log("errors:", errors.length ? errors : "none", "| home stat:", streak);
await browser.close();
server.stop();
