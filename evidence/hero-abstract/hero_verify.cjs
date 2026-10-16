#!/usr/bin/env node
/**
 * Hero-focused browser verification for the portfolio hero-assets branch.
 * Serves the WORKTREE (not main) and asserts the new abstract plates render,
 * the duotone reveal works (hover + keyboard focus), there are zero console/page
 * errors and zero failed requests (no 404 for the removed anime plates), and the
 * hero does not overflow at desktop or mobile widths.
 *
 * Run:
 *   NODE_PATH=/mnt/datos/proyectos/videojuego-fps/node_modules \
 *   node hero_verify.cjs <rootDir> <evidenceDir>
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT_DIR = path.resolve(process.argv[2] || ".");
const OUT_DIR = path.resolve(process.argv[3] || path.join(ROOT_DIR, "evidence"));
fs.mkdirSync(OUT_DIR, { recursive: true });

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
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
      res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

const HERO_PROBE = () => {
  const imgs = [...document.querySelectorAll(".dx-hero-plate img")].map((i) => ({
    src: new URL(i.getAttribute("src"), location.href).pathname,
    naturalWidth: i.naturalWidth,
    naturalHeight: i.naturalHeight,
    complete: i.complete,
  }));
  const plate = document.querySelector(".dx-hero-plate");
  const copy = document.querySelector(".dx-hero-copy");
  const r = plate ? plate.getBoundingClientRect() : null;
  return {
    heroPresent: !!document.querySelector("#top.dx-hero"),
    plateImages: imgs,
    plateAriaLabel: plate ? plate.getAttribute("aria-label") : null,
    plateRect: r ? { w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right) } : null,
    plateAspect: r ? Number((r.width / r.height).toFixed(3)) : null,
    copyTextSample: copy ? copy.textContent.replace(/\s+/g, " ").trim().slice(0, 120) : null,
    heroHeading: (document.getElementById("hero-heading") || {}).textContent || null,
    anyAnimeAssetOnPage: [...document.querySelectorAll("img,source")].some((n) =>
      /hero-anime|hero-totem/.test(n.getAttribute("src") || "")
    ),
    docScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    visibleOverflow: [...document.querySelectorAll("*")].filter((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      return cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 1;
    }).map((el) => el.tagName.toLowerCase() + "." + String(el.className || "").trim().split(/\s+/).join(".")).slice(0, 8),
  };
};

const COLOR_OPACITY = () =>
  getComputedStyle(document.querySelector(".dx-hero-plate .nw-mission-color")).opacity;

(async () => {
  const { server, port } = await startServer(0);
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log("server:", baseUrl, "root:", ROOT_DIR);

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => failedRequests.push({ url: r.url(), failure: r.failure() }));
  page.on("response", (r) => r.status() >= 400 && failedRequests.push({ url: r.url(), failure: `HTTP ${r.status()}` }));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const desktop = await page.evaluate(HERO_PROBE);
  console.log("desktop:", JSON.stringify(desktop, null, 2));

  // Initial hero state at load. The hero plate sits near the viewport centre, so
  // app.js's isNearViewportCenter() scroll mechanism has already set
  // data-color-active (same behaviour as every other .nw-mission plate) -> the
  // purple duotone layer is the resting state of the hero.
  await page.screenshot({ path: path.join(OUT_DIR, "hero-desktop-initial.png") });
  const initialReveal = await page.evaluate((fn) => ({
    activeCount: document.querySelectorAll("[data-color-active]").length,
    heroPlateActive: !!document.querySelector(".dx-hero-plate[data-color-active]"),
    colorOpacity: eval(`(${fn})`)(),
  }), COLOR_OPACITY.toString());
  console.log("initialReveal:", JSON.stringify(initialReveal));

  // Resting silver-mono state: pointer away from the plate and the scroll-driven
  // reveal flag cleared, so only the mono layer paints.
  await page.mouse.move(4, 4);
  await page.evaluate(() => document.querySelector(".dx-hero-plate").removeAttribute("data-color-active"));
  await page.waitForTimeout(900);
  const monoState = await page.evaluate((fn) => {
    const p = document.querySelector(".dx-hero-plate");
    const m = p.querySelector(".nw-color-reveal:not(.nw-mission-color)");
    return { colorOpacity: eval(`(${fn})`)(), monoOpacity: getComputedStyle(m).opacity, monoNaturalW: m.naturalWidth };
  }, COLOR_OPACITY.toString());
  await page.screenshot({ path: path.join(OUT_DIR, "hero-desktop-mono.png") });
  console.log("monoState:", JSON.stringify(monoState));

  // Reveal #1 — pointer hover.
  const plate = page.locator(".dx-hero-plate").first();
  await plate.hover();
  await page.waitForTimeout(900);
  const revealHover = await page.evaluate((fn) => ({ colorOpacity: eval(`(${fn})`)() }), COLOR_OPACITY.toString());
  await page.screenshot({ path: path.join(OUT_DIR, "hero-desktop-color.png") });
  console.log("reveal(hover):", JSON.stringify(revealHover));

  // The reveal must fall back to mono when the pointer leaves.
  await page.mouse.move(4, 4);
  await page.waitForTimeout(900);
  const hoverOff = await page.evaluate((fn) => ({ colorOpacity: eval(`(${fn})`)() }), COLOR_OPACITY.toString());
  console.log("hoverOff:", JSON.stringify(hoverOff));

  // Reveal #2 — keyboard focus (the accessibility path).
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await plate.focus();
  await page.waitForTimeout(900);
  const revealFocus = await page.evaluate((fn) => ({
    colorOpacity: eval(`(${fn})`)(),
    focused: document.activeElement ? document.activeElement.className : "",
  }), COLOR_OPACITY.toString());
  await page.screenshot({ path: path.join(OUT_DIR, "hero-desktop-focus.png") });
  console.log("reveal(focus):", JSON.stringify(revealFocus));
  await ctx.close();

  // mobile
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  mpage.on("console", (m) => m.type() === "error" && consoleErrors.push("[mobile] " + m.text()));
  mpage.on("pageerror", (e) => pageErrors.push("[mobile] " + String(e)));
  mpage.on("response", (r) => r.status() >= 400 && failedRequests.push({ url: r.url(), failure: `HTTP ${r.status()}` }));
  await mpage.goto(baseUrl, { waitUntil: "networkidle" });
  await mpage.waitForTimeout(600);
  const mobile = await mpage.evaluate(HERO_PROBE);
  await mpage.screenshot({ path: path.join(OUT_DIR, "hero-mobile.png") });
  console.log("mobile:", JSON.stringify(mobile, null, 2));
  await mctx.close();

  // narrow overflow sweep on the hero only
  const sweep = [];
  for (const w of [1440, 1024, 768, 390, 360, 320]) {
    const c = await browser.newContext({ viewport: { width: w, height: 800 } });
    const p = await c.newPage();
    await p.goto(baseUrl, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    const r = await p.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      vw: window.innerWidth,
      plate: (({ width, height }) => ({ w: Math.round(width), h: Math.round(height) }))(document.querySelector(".dx-hero-plate").getBoundingClientRect()),
      plateRight: Math.round(document.querySelector(".dx-hero-plate").getBoundingClientRect().right),
    }));
    sweep.push({ w, ...r, overflow: r.doc - r.vw, plateEscapes: r.plateRight > r.vw + 1 });
    await c.close();
  }
  console.log("sweep:", JSON.stringify(sweep));

  await browser.close();
  server.close();

  const report = {
    timestamp: new Date().toISOString(),
    root: ROOT_DIR,
    baseUrl,
    consoleErrors,
    pageErrors,
    failedRequests,
    desktop,
    initialReveal,
    monoState,
    revealHover,
    hoverOff,
    revealFocus,
    mobile,
    viewportSweep: sweep,
    verdict: {
      noConsoleErrors: consoleErrors.length === 0,
      noPageErrors: pageErrors.length === 0,
      noFailedRequests: failedRequests.length === 0,
      platesLoaded: desktop.plateImages.length === 2 && desktop.plateImages.every((i) => i.naturalWidth > 0),
      platesAreAbstract: desktop.plateImages.every((i) => /hero-abstract-(mono|color)\.png$/.test(i.src)),
      noAnimeOnPage: !desktop.anyAnimeAssetOnPage,
      monoLayerRenders: monoState.monoOpacity === "1" && monoState.monoNaturalW > 0 && monoState.colorOpacity === "0",
      revealOnHover: revealHover.colorOpacity === "1",
      hoverOffRestoresMono: hoverOff.colorOpacity === "0",
      revealOnFocus: revealFocus.colorOpacity === "1" && /dx-hero-plate/.test(revealFocus.focused),
      noOverflowAnyViewport: sweep.every((s) => s.overflow <= 0),
      noPlateEscape: sweep.every((s) => !s.plateEscapes),
    },
  };
  fs.writeFileSync(path.join(OUT_DIR, "hero-verification-report.json"), JSON.stringify(report, null, 2));
  console.log("VERDICT:", JSON.stringify(report.verdict));
  const ok = Object.values(report.verdict).every(Boolean);
  console.log(ok ? "HERO VERIFY: PASS" : "HERO VERIFY: FAIL");
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("HERO VERIFY ERROR:", e);
  process.exit(1);
});
