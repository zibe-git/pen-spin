/* Static server for dist/ that sends the pre-compressed files (brotli, else gzip) with proper caching.
 *   bun scripts/serve.ts [--port 4173] [--dev]     --dev rebuilds when anything in src/ or public/ changes
 */
import { existsSync, watch } from "node:fs";
import { extname, join, normalize } from "node:path";
import { build } from "./build";

const DIST = join(import.meta.dir, "..", "dist");
const args = process.argv.slice(2), dev = args.includes("--dev");
const port = Number(args[args.indexOf("--port") + 1]) || 4173;
const TYPES: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8" };

if (dev || !existsSync(join(DIST, "index.html"))) await build();
if (dev) {
  let t: ReturnType<typeof setTimeout> | undefined;
  for (const dir of ["src", "public"]) watch(join(import.meta.dir, "..", dir), { recursive: true }, () => {
    clearTimeout(t);
    t = setTimeout(() => build().then((r) => console.log(`rebuilt in ${r.ms.toFixed(0)} ms`), (e) => console.error(e)), 60);
  });
}

export const server = Bun.serve({
  port,
  async fetch(req) {
    let path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^[/\\]+/, "");
    if (!path || path.endsWith("/") || path.endsWith("\\")) path += "index.html";
    if (path.includes("..")) return new Response("no", { status: 400 });
    const file = join(DIST, path), type = TYPES[extname(path)];
    if (!type || !existsSync(file)) return new Response("Not found", { status: 404 });
    const accept = req.headers.get("accept-encoding") || "";
    const enc = accept.includes("br") && existsSync(file + ".br") ? "br" : accept.includes("gzip") && existsSync(file + ".gz") ? "gzip" : "";
    const body = Bun.file(enc ? file + (enc === "br" ? ".br" : ".gz") : file);
    const headers: Record<string, string> = {
      "content-type": type,
      // the page and the service worker must revalidate; everything else may be cached for a day
      "cache-control": path.endsWith(".html") || path === "sw.js" || dev ? "no-cache" : "public, max-age=86400",
      vary: "accept-encoding",
      "x-content-type-options": "nosniff",
    };
    if (enc) headers["content-encoding"] = enc;
    return new Response(body, { headers });
  },
});
console.log(`Pen Spin on http://localhost:${server.port}${dev ? "  (dev: rebuilds on change)" : ""}`);
