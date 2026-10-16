#!/usr/bin/env node
/**
 * Capture BEFORE / AFTER header comparison shots (desktop 1440x900 + mobile 390x844).
 * Usage: node capture_header_comparison.cjs <before|after>
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = "/mnt/datos/proyectos/dnzlfx-portfolio-demo";
const OUT_DIR = path.join(ROOT_DIR, "evidence");
const phase = process.argv[2] === "after" ? "after" : "before";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
};

function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const filePath = path.join(ROOT_DIR, rel);
      if (!filePath.startsWith(ROOT_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { server, port } = await startServer(0);
  const baseUrl = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch({ headless: true });

  const shots = [];
  for (const vp of [
    { tag: "desktop", width: 1440, height: 900, clipHeight: 260 },
    { tag: "mobile", width: 390, height: 844, clipHeight: 200 },
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const out = path.join(OUT_DIR, `header-${phase}-${vp.tag}.png`);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: vp.width, height: vp.clipHeight } });
    // also a full-viewport shot for context
    const outFull = path.join(OUT_DIR, `header-${phase}-${vp.tag}-viewport.png`);
    await page.screenshot({ path: outFull });
    shots.push(out, outFull);
    await ctx.close();
  }

  await browser.close();
  server.close();
  console.log("Wrote:", shots.join("\n"));
})();
