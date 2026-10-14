/* Production build: one self-contained index.html (JS + CSS + shaders inlined and minified), plus the PWA
 * manifest, icon and a service worker, each pre-compressed (brotli + gzip) for the server.
 *
 *   bun scripts/build.ts          build to dist/ and print the size report
 */
import type { BunPlugin } from "bun";
import { brotliCompressSync, gzipSync, constants } from "node:zlib";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, ".."), SRC = join(ROOT, "src"), OUT = join(ROOT, "dist");

/** GLSL minifier: comments and whitespace out; spaces only where two words would otherwise merge. */
export function minifyGlsl(src: string) {
  const flat = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "").replace(/\s+/g, " ");
  if (/[+-] [+-]/.test(flat)) throw new Error("GLSL: `- -` / `+ +` would merge into an operator");
  return flat.replace(/ ?([{}()[\];,=+\-*/<>!?:&|.]) ?/g, "$1").trim();
}
const glsl: BunPlugin = {
  name: "glsl",
  setup(b) {
    b.onLoad({ filter: /\.(glsl|vert|frag)$/ }, async (a) => ({ contents: `export default ${JSON.stringify(minifyGlsl(await Bun.file(a.path).text()))};`, loader: "js" }));
  },
};

/** HTML: drop comments and the whitespace of the source layout (but never a space between words). */
const minifyHtml = (s: string) => s.replace(/<!--(?!JS)[\s\S]*?-->/g, "").replace(/>\s*\n\s*</g, "><").replace(/\s*\n\s*/g, " ").trim();

export async function build() {
  const t0 = performance.now();
  const js = await Bun.build({ entrypoints: [join(SRC, "main.ts")], minify: true, target: "browser", format: "esm", plugins: [glsl], sourcemap: "none" });
  if (!js.success) throw new AggregateError(js.logs, "JS build failed");
  const css = await Bun.build({ entrypoints: [join(SRC, "style.css")], minify: true });
  if (!css.success) throw new AggregateError(css.logs, "CSS build failed");
  const jsText = (await js.outputs[0]!.text()).trim().replace(/<\/script/gi, "<\\/script");
  const cssText = (await css.outputs[0]!.text()).trim();
  const html = minifyHtml(readFileSync(join(SRC, "index.html"), "utf8"))
    .replace("/*CSS*/", () => cssText)
    .replace("<!--JS-->", () => `<script type="module">${jsText}</script>`);

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const version = Bun.hash(html).toString(36);
  const files: Record<string, string> = {
    "index.html": html,
    "manifest.webmanifest": JSON.stringify(JSON.parse(readFileSync(join(ROOT, "public", "manifest.webmanifest"), "utf8"))),
    "icon.svg": readFileSync(join(ROOT, "public", "icon.svg"), "utf8").replace(/\s*\n\s*/g, ""),
    "sw.js": readFileSync(join(ROOT, "public", "sw.js"), "utf8").replace("__VERSION__", version).replace(/^\s*\/\/.*\n/gm, "").replace(/\s*\n\s*/g, ""),
    "robots.txt": "User-agent: *\nAllow: /\n",
  };
  const rows: [string, number, number, number][] = [];
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
    const gz = gzipSync(raw, { level: 9 });
    writeFileSync(join(OUT, name), raw);
    writeFileSync(join(OUT, name + ".br"), br);
    writeFileSync(join(OUT, name + ".gz"), gz);
    rows.push([name, raw.length, gz.length, br.length]);
  }
  return { rows, ms: performance.now() - t0, js: jsText.length, css: cssText.length, version };
}

if (import.meta.main) {
  const r = await build();
  const kb = (n: number) => (n / 1024).toFixed(1).padStart(7) + " KB";
  console.log(`\n  built in ${r.ms.toFixed(0)} ms (version ${r.version})   js ${kb(r.js)}   css ${kb(r.css)}\n`);
  console.log("  file                      raw        gzip      brotli");
  for (const [n, raw, gz, br] of r.rows) console.log(`  ${n.padEnd(22)}${kb(raw)}${kb(gz)}${kb(br)}`);
  const tot = r.rows.reduce((a, x) => [a[0]! + x[1], a[1]! + x[2], a[2]! + x[3]], [0, 0, 0]);
  console.log(`  ${"total".padEnd(22)}${kb(tot[0]!)}${kb(tot[1]!)}${kb(tot[2]!)}\n`);
}
