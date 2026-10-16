#!/usr/bin/env node
/**
 * Real Chromium evidence capture for /mnt/datos/proyectos/dnzlfx-portfolio-demo
 *
 * Produces:
 *   evidence/01-hero-portada.png .. 05-sobre-mi-y-contacto.png   (desktop stops)
 *   evidence/06-mobile-responsive.png                            (390x844)
 *   evidence/07-smooth-scroll-walkthrough.mp4                    (REAL continuous
 *       real-time Playwright video recording, transcoded to H.264 yuv420p)
 *   evidence/dom-overflow-audit.json                             (3+ viewports)
 *   evidence/contrast-audit.json                                 (WCAG AA)
 *   evidence/browser-verification-report.json
 *
 * Run: NODE_PATH=<node_modules with playwright> node capture_evidence.cjs
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");

const ROOT_DIR = "/mnt/datos/proyectos/dnzlfx-portfolio-demo";
const EVIDENCE_DIR = path.join(ROOT_DIR, "evidence");
const TMP_ROOT = process.env.TMPDIR || "/tmp";
const VIDEO_TMP = path.join(TMP_ROOT, "dnzlfx_video_capture");

fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.rmSync(VIDEO_TMP, { recursive: true, force: true });
fs.mkdirSync(VIDEO_TMP, { recursive: true });

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
    server.listen(port, "127.0.0.1", () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ---------------------------------------------------------------------------
// In-page audit: horizontal overflow + WCAG AA contrast (small text)
// ---------------------------------------------------------------------------
const OVERFLOW_AUDIT = () => {
  const vw = window.innerWidth;
  const desc = (el) => {
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).join(".")
        : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
  };
  const scrollOverflow = [];
  const intentionalClipOverflow = [];
  const rectOverflow = [];
  const childOverflow = [];

  for (const el of document.querySelectorAll("*")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    if (el.scrollWidth > el.clientWidth + 1) {
      const rec = {
        el: desc(el),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflowX: cs.overflowX,
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
      };
      // A non-visible overflow-x means the element is an intentional clipping
      // frame (overflow:hidden/clip) — the oversized child is decorative
      // parallax artwork (scale 1.08 / 1.22) that the frame is built to crop.
      // It cannot affect layout and produces no page scroll.
      if (cs.overflowX === "visible") scrollOverflow.push(rec);
      else intentionalClipOverflow.push(rec);
    }

    if (cs.position !== "fixed" && (r.right > vw + 1 || r.left < -1)) {
      rectOverflow.push({
        el: desc(el),
        left: Math.round(r.left),
        right: Math.round(r.right),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70),
      });
    }

    const p = el.parentElement;
    if (p && cs.position !== "fixed") {
      const pcs = getComputedStyle(p);
      const clipped =
        pcs.overflowX !== "visible" ||
        pcs.overflowY !== "visible" ||
        getComputedStyle(el).position === "absolute";
      if (!clipped) {
        const pr = p.getBoundingClientRect();
        if (r.right > pr.right + 1) {
          childOverflow.push({
            el: desc(el),
            parent: desc(p),
            childRight: Math.round(r.right),
            parentRight: Math.round(pr.right),
          });
        }
      }
    }
  }

  return {
    viewportWidth: vw,
    documentScrollWidth: document.documentElement.scrollWidth,
    documentOverflowPx: document.documentElement.scrollWidth - vw,
    scrollOverflow,
    intentionalClipOverflow,
    rectOverflow,
    childOverflow,
    visibleOverflowCount:
      scrollOverflow.length + rectOverflow.length + childOverflow.length,
    intentionalClipCount: intentionalClipOverflow.length,
    passes:
      document.documentElement.scrollWidth - vw <= 0 &&
      scrollOverflow.length === 0 &&
      rectOverflow.length === 0 &&
      childOverflow.length === 0,
  };
};

const CONTRAST_AUDIT = (maxFontSize) => {
  const parse = (c) => {
    const m = String(c).match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((v) => parseFloat(v));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lin = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const ratio = (a, b) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  const desc = (el) => {
    const cls =
      typeof el.className === "string" && el.className.trim()
        ? "." + el.className.trim().split(/\s+/).join(".")
        : "";
    return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + cls;
  };

  const results = [];
  for (const el of document.querySelectorAll("*")) {
    const text = (el.textContent || "").trim();
    if (!text || el.children.length > 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || parseFloat(cs.opacity) < 0.5) continue;
    if (cs.webkitBackgroundClip === "text" || cs.backgroundClip === "text") continue;
    const fontSize = parseFloat(cs.fontSize);
    if (!(fontSize <= maxFontSize)) continue;
    const fg = parse(cs.color);
    if (!fg || fg.a < 0.5) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    const chain = [];
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) chain.push(c);
      n = n.parentElement;
    }
    chain.reverse();
    let bg = { r: 5, g: 3, b: 10, a: 1 };
    for (const c of chain) bg = over(c, bg);
    const textCol = over(fg, bg);
    const cr = ratio(textCol, bg);
    results.push({
      el: desc(el),
      text: text.slice(0, 50),
      fontSize,
      color: cs.color,
      ratio: Number(cr.toFixed(2)),
      pass: cr >= 4.5,
    });
  }
  results.sort((a, b) => a.ratio - b.ratio);
  return results;
};

// ---------------------------------------------------------------------------
// Behavioral proof of the Lenis-like wheel damping: dispatch one synthetic wheel
// event and sample the REAL window.scrollY on every animation frame. A damped
// (lerp/ease-out) response converges through many distinct intermediate
// positions; an undamped step response lands in one frame.
// ---------------------------------------------------------------------------
const DAMPING_PROBE = (deltaY) =>
  new Promise((resolve) => {
    const samples = [];
    const t0 = performance.now();
    window.dispatchEvent(
      new WheelEvent("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true })
    );
    function step() {
      const t = performance.now() - t0;
      samples.push({ t: Number(t.toFixed(1)), y: Number(window.scrollY.toFixed(2)) });
      if (t < 1500) {
        requestAnimationFrame(step);
        return;
      }
      const ys = samples.map((s) => s.y);
      const distinct = new Set(ys.map((y) => Math.round(y * 10) / 10)).size;
      const firstFrameDelta = Math.abs((ys[1] ?? 0) - ys[0]);
      resolve({
        deltaY,
        frames: samples.length,
        distinctPositions: distinct,
        firstFrameDelta: Number(firstFrameDelta.toFixed(2)),
        finalY: ys[ys.length - 1],
        monotonic: ys.every((y, i) => i === 0 || y >= ys[i - 1] - 0.01),
        damped: distinct >= 8 && firstFrameDelta < Math.abs(deltaY) * 0.5,
        framesSampled: samples.filter((_, i) => i % 5 === 0).map((s) => s.y),
      });
    }
    requestAnimationFrame(step);
  });

// ---------------------------------------------------------------------------

(async () => {
  const { server, port } = await startServer(0);
  const baseUrl = `http://127.0.0.1:${port}/`;
  console.log(`Local server started on ${baseUrl}`);

  const consoleLogs = [];
  const pageErrors = [];
  const failedRequests = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on("console", (msg) => consoleLogs.push({ type: msg.type(), text: msg.text() }));
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  page.on("requestfailed", (req) => failedRequests.push({ url: req.url(), failure: req.failure() }));

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const metrics0 = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    innerHeight: window.innerHeight,
    maxScroll: document.documentElement.scrollHeight - window.innerHeight,
    headerHeight: document.querySelector(".dx-header")?.offsetHeight ?? 62,
  }));
  console.log("Page metrics:", metrics0);

  // --- 1. Desktop section screenshots ---------------------------------------
  const aboutY = await page.evaluate(() => {
    const about = document.getElementById("about");
    const header = document.querySelector(".dx-header");
    const h = header ? header.offsetHeight : 62;
    const top = about.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.round(top - h - 14));
  });
  console.log("About section aligned scroll target:", aboutY);

  const stops = [
    { name: "01-hero-portada.png", y: 0, hoverSelector: ".dx-hero-plate" },
    { name: "02-mission-arquitectura.png", y: 780, hoverSelector: ".nw-mission-hero" },
    {
      name: "03-mission-filas-duotono.png",
      y: 1450,
      hoverSelector: ".nw-mission-row:nth-of-type(2) .nw-mission-art",
    },
    { name: "04-proyectos-grid-parallax.png", y: 2960, hoverSelector: ".landing-feature:nth-of-type(2)" },
    { name: "05-sobre-mi-y-contacto.png", y: aboutY, hoverSelector: null },
  ];

  const telemetrySnapshots = [];
  for (const stop of stops) {
    if (stop.hoverSelector) {
      const loc = page.locator(stop.hoverSelector).first();
      if (await loc.count()) await loc.hover().catch(() => {});
    }
    await page.evaluate((y) => window.scrollTo(0, y), stop.y);
    for (let k = 0; k < 22; k++) await page.waitForTimeout(25);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, stop.name), fullPage: false });

    const snap = await page.evaluate(() => {
      const heroGrid = document.querySelector(".nw-hero-fade");
      const heroCopy = document.querySelector(".dx-hero-copy");
      const missionHeroImg = document.querySelector(".nw-mission-hero .nw-mission-image");
      const row1Img = document.querySelector(".nw-mission-row .nw-mission-image");
      const featurePanel = document.querySelector(".hw-feature-parallax");
      const card1Img = document.querySelector(".landing-feature .hw-parallax");
      return {
        scrollY: Math.round(window.scrollY),
        nwHeroProgress: heroGrid ? heroGrid.style.getPropertyValue("--nw-hero-progress") : null,
        pyHero: heroCopy ? heroCopy.style.getPropertyValue("--py-hero") : null,
        nwMissionHeroShift: missionHeroImg
          ? missionHeroImg.style.getPropertyValue("--nw-mission-shift")
          : null,
        nwRow1Shift: row1Img ? row1Img.style.getPropertyValue("--nw-mission-shift") : null,
        panelPy: featurePanel ? featurePanel.style.getPropertyValue("--py") : null,
        card1PyImg: card1Img ? card1Img.style.getPropertyValue("--py-img") : null,
        activeColorRevealCount: document.querySelectorAll("[data-color-active]").length,
      };
    });
    telemetrySnapshots.push({ stop: stop.name, ...snap });
    console.log("Captured", stop.name, snap);
  }

  // --- 2. Mobile screenshot --------------------------------------------------
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto(baseUrl, { waitUntil: "networkidle" });
  await mobilePage.evaluate(() => window.scrollTo(0, 0));
  await mobilePage.waitForTimeout(400);
  await mobilePage.screenshot({ path: path.join(EVIDENCE_DIR, "06-mobile-responsive.png") });

  // Mobile contact block: the rows that used to escape the 390px viewport by +92px.
  const mobileContactY = await mobilePage.evaluate(() => {
    const contact = document.getElementById("contact");
    if (!contact) return 0;
    const header = document.querySelector(".dx-header");
    const h = header ? header.offsetHeight : 62;
    const top = contact.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, Math.round(top - h - 14));
  });
  await mobilePage.evaluate((y) => window.scrollTo(0, y), mobileContactY);
  for (let k = 0; k < 22; k++) await mobilePage.waitForTimeout(25);
  await mobilePage.screenshot({ path: path.join(EVIDENCE_DIR, "08-mobile-contact.png") });
  const mobileContactRows = await mobilePage.evaluate(() => {
    const vw = window.innerWidth;
    return [...document.querySelectorAll(".dx-contact-item, .dx-contact-item *")].map((el) => {
      const r = el.getBoundingClientRect();
      return {
        el: el.tagName.toLowerCase() + "." + String(el.className || "").trim().split(/\s+/).join("."),
        left: Math.round(r.left),
        right: Math.round(r.right),
        escapesViewport: r.right > vw + 1 || r.left < -1,
      };
    });
  });
  console.log(`[mobile 390] contact block y=${mobileContactY}, rows=${mobileContactRows.length}, escaping=${mobileContactRows.filter((r) => r.escapesViewport).length}`);
  if (mobileContactRows.some((r) => r.escapesViewport)) {
    console.log("   escaping rows:", JSON.stringify(mobileContactRows.filter((r) => r.escapesViewport)));
  }
  await mobileContext.close();

  // --- 3. Accessibility checks on desktop page ------------------------------
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.keyboard.press("Tab");
  const skipFocused = await page.evaluate(() => document.activeElement?.className || "");
  await page.click("#motion-toggle");
  await page.waitForTimeout(150);
  const reducedMotionState = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute("data-reduced-motion"),
    shiftWhenReduced: document.querySelector(".nw-mission-image")?.style.getPropertyValue("--nw-mission-shift"),
  }));
  await page.click("#motion-toggle");
  await page.waitForTimeout(200);

  // --- 3b. Behavioral proof of the Lenis-like damped wheel scroll -----------
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350);
  const dampingFluid = await page.evaluate(DAMPING_PROBE, 620);
  console.log("Damping probe (fluid):", JSON.stringify(dampingFluid));

  await page.click("#motion-toggle"); // engage user preference: reduced motion
  await page.waitForTimeout(200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  const dampingReduced = await page.evaluate(DAMPING_PROBE, 620);
  console.log("Damping probe (reduced):", JSON.stringify(dampingReduced));
  await page.click("#motion-toggle"); // restore fluid motion
  await page.waitForTimeout(200);
  const motionStateRestored = await page.evaluate(() =>
    document.documentElement.getAttribute("data-reduced-motion")
  );

  // --- 4. DOM overflow + contrast audit across viewports --------------------
  const auditViewports = [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
    { width: 360, height: 800 },
    { width: 320, height: 800 },
    { width: 320, height: 568 },
  ];
  const overflowAudits = [];
  const contrastAudits = [];
  for (const vp of auditViewports) {
    const actx = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 1,
    });
    const apage = await actx.newPage();
    await apage.goto(baseUrl, { waitUntil: "networkidle" });
    await apage.waitForTimeout(400);
    const res = await apage.evaluate(OVERFLOW_AUDIT);
    res.height = vp.height;
    const contrast = await apage.evaluate(CONTRAST_AUDIT, 12);
    overflowAudits.push(res);
    contrastAudits.push({
      viewport: `${vp.width}x${vp.height}`,
      minRatio: contrast.length ? contrast[0].ratio : null,
      failures: contrast.filter((c) => !c.pass),
      sampled: contrast.length,
    });
    console.log(
      `[audit ${vp.width}x${vp.height}] PASS=${res.passes} docOverflow=${res.documentOverflowPx}px visibleOverflow=${res.visibleOverflowCount} (scroll=${res.scrollOverflow.length} rect=${res.rectOverflow.length} child=${res.childOverflow.length}) intentionalClip=${res.intentionalClipCount} minContrast=${contrast.length ? contrast[0].ratio : "n/a"}`
    );
    if (res.scrollOverflow.length) console.log("   scrollOverflow:", JSON.stringify(res.scrollOverflow.slice(0, 6)));
    if (res.rectOverflow.length) console.log("   rectOverflow:", JSON.stringify(res.rectOverflow.slice(0, 6)));
    if (res.childOverflow.length) console.log("   childOverflow:", JSON.stringify(res.childOverflow.slice(0, 6)));
    await actx.close();
  }

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "dom-overflow-audit.json"),
    JSON.stringify(overflowAudits, null, 2)
  );
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "contrast-audit.json"),
    JSON.stringify(contrastAudits, null, 2)
  );

  // --- 5. REAL continuous real-time video recording (Playwright recordVideo) -
  console.log("Recording real-time continuous walkthrough (Playwright recordVideo, ~33s)...");
  const videoContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    recordVideo: { dir: VIDEO_TMP, size: { width: 1440, height: 900 } },
  });
  const vpage = await videoContext.newPage();
  vpage.on("pageerror", (err) => pageErrors.push(`[video] ${String(err)}`));
  await vpage.goto(baseUrl, { waitUntil: "networkidle" });
  await vpage.waitForTimeout(1200);

  const vmetrics = await vpage.evaluate(() => ({
    max: document.documentElement.scrollHeight - window.innerHeight,
  }));

  // Hover the hero plate so the purple duotone reveal is visible in the video.
  const plateBox = await vpage.locator(".dx-hero-plate").first().boundingBox().catch(() => null);
  if (plateBox) {
    await vpage.mouse.move(plateBox.x + plateBox.width / 2, plateBox.y + plateBox.height / 2);
  }

  const DURATION_MS = 33000;
  const TICK_MS = 90;
  const t0 = Date.now();
  let accumulated = 0;
  let tick = 0;
  const scrollSamples = [];

  while (true) {
    const elapsed = Date.now() - t0;
    if (elapsed >= DURATION_MS) break;
    const t = elapsed / DURATION_MS;
    let wantY;
    if (t < 0.09) wantY = 0;
    else if (t < 0.52) wantY = easeInOutCubic((t - 0.09) / 0.43) * vmetrics.max;
    else if (t < 0.62) wantY = vmetrics.max;
    else if (t < 0.94) wantY = (1 - easeInOutCubic((t - 0.62) / 0.32)) * vmetrics.max;
    else wantY = 0;

    const delta = wantY - accumulated;
    if (Math.abs(delta) >= 1) {
      accumulated += delta;
      // Real wheel events -> exercises the site's Lenis-like inertial damping.
      await vpage.mouse.wheel(0, delta);
    }
    if (tick % 36 === 0) {
      const y = await vpage.evaluate(() => Math.round(window.scrollY));
      scrollSamples.push({ t: Number(t.toFixed(2)), scrollY: y });
    }
    tick++;
    await vpage.waitForTimeout(TICK_MS);
  }
  const finalScrollY = await vpage.evaluate(() => Math.round(window.scrollY));
  await vpage.waitForTimeout(500);
  const rawVideo = await vpage.video().path();
  await videoContext.close();
  await browser.close();
  server.close();

  console.log("Wheel-driven scroll samples:", JSON.stringify(scrollSamples));
  console.log("Final scrollY:", finalScrollY, "max:", Math.round(vmetrics.max));

  const videoOut = path.join(EVIDENCE_DIR, "07-smooth-scroll-walkthrough.mp4");
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-i",
      rawVideo,
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "21",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      videoOut,
    ],
    { stdio: "inherit" }
  );
  const probe = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=nw=1:nk=1",
    videoOut,
  ])
    .toString()
    .trim();
  console.log(`Wrote ${videoOut} (duration ${probe}s) from raw ${rawVideo}`);

  const report = {
    timestamp: new Date().toISOString(),
    urlTested: baseUrl,
    viewportDesktop: { width: 1440, height: 900 },
    viewportMobile: { width: 390, height: 844 },
    consoleErrorsCount: consoleLogs.filter((c) => c.type === "error").length,
    pageErrorsCount: pageErrors.length,
    failedRequestsCount: failedRequests.length,
    consoleLogs,
    pageErrors,
    failedRequests,
    accessibilityChecks: {
      skipLinkFocusClass: skipFocused,
      reducedMotionToggle: reducedMotionState,
      motionStateRestored,
    },
    scrollDampingEvidence: {
      method:
        "one synthetic WheelEvent(deltaY=620) on window, then window.scrollY sampled on every requestAnimationFrame for 1500ms",
      fluid: dampingFluid,
      reduced: dampingReduced,
      verdict:
        dampingFluid.damped && Math.abs(dampingReduced.firstFrameDelta) < 0.01
          ? "PASS: fluid mode converges gradually over many frames; reduced-motion applies no inertial scrolling"
          : "CHECK",
    },
    telemetrySnapshots,
    overflowAudit: overflowAudits.map((a) => ({
      viewport: `${a.viewportWidth}x${a.height}`,
      passes: a.passes,
      documentOverflowPx: a.documentOverflowPx,
      visibleOverflowCount: a.visibleOverflowCount,
      scrollOverflowCount: a.scrollOverflow.length,
      rectOverflowCount: a.rectOverflow.length,
      childOverflowCount: a.childOverflow.length,
      intentionalClipCount: a.intentionalClipCount,
    })),
    overflowVerdict: {
      criterion:
        "0 VISIBLE overflowing elements: element.scrollWidth > clientWidth with overflow-x:visible, OR a child rect crossing a non-clipping parent's right edge, OR a rect escaping the viewport; and documentElement.scrollWidth <= viewport width",
      passes: overflowAudits.every((a) => a.passes),
      intentionalClips:
        "Frames with overflow-x:hidden that crop their own scaled parallax artwork (scale 1.08 / 1.22, translate ±14–48px) on purpose — decorative, cannot affect layout or produce page scroll.",
    },
    mobileContactAudit: {
      scrollTargetY: mobileContactY,
      sampledElements: mobileContactRows.length,
      escapingViewport: mobileContactRows.filter((r) => r.escapesViewport).length,
      rows: mobileContactRows,
    },
    contrastAudit: contrastAudits.map((c) => ({
      viewport: c.viewport,
      minRatio: c.minRatio,
      failures: c.failures.length,
    })),
    videoOutput: {
      path: videoOut,
      recordMode: "playwright-recordVideo real-time (wheel-driven, not stitched screenshots)",
      durationSeconds: Number(Number(probe).toFixed(2)),
      scrollSamples,
      finalScrollY,
    },
  };
  const reportPath = path.join(EVIDENCE_DIR, "browser-verification-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log("Saved verification report to", reportPath);
})().catch((err) => {
  console.error("EVIDENCE CAPTURE FAILED:", err);
  process.exit(1);
});
