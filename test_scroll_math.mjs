#!/usr/bin/env node
/**
 * Self-contained verification test suite for dnzlfx-portfolio-demo scroll, parallax
 * and footer-mural math. No dependencies: pure Node + the real app module.
 *
 * Run with: node .worktrees/footer-motion/test_scroll_math.mjs
 * (or `node test_scroll_math.mjs` from inside the worktree)
 *
 * The suite reads index.html / styles.css / app.js from ITS OWN directory, so the
 * same file verifies the main checkout and any worktree it is copied into.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  clamp,
  computeViewportRatio,
  computeMissionShiftPx,
  computeFeatureImageShiftPx,
  computeHeroMetrics,
  computePanelOverlapPx,
  computeFooterProgress,
  computeFooterLayerOffsetPx,
  computeRevealFactor,
  isNearViewportCenter,
  lerp,
  damp,
  TRANSFORM_LAMBDA,
} from "./app.js";

const dir = path.dirname(fileURLToPath(import.meta.url));

// 1. Test clamp
assert.equal(clamp(5, -1, 1), 1);
assert.equal(clamp(-5, -1, 1), -1);
assert.equal(clamp(0.25, -1, 1), 0.25);

// 2. Test computeViewportRatio (i in [-1, 1])
// When element center == viewport center (rectTop = 290, rectHeight = 320, vh = 900 -> 290+160 = 450 == 900/2)
assert.equal(computeViewportRatio(290, 320, 900), 0);
// When element is below viewport center -> positive ratio
assert.ok(computeViewportRatio(700, 320, 900) > 0);
// When element is above viewport center -> negative ratio
assert.ok(computeViewportRatio(-200, 320, 900) < 0);

// 3. Test Mecanismo 1: computeMissionShiftPx (--nw-mission-shift)
// For height=460, 0.035*460 = 16.1 -> capped at 14px max amplitude
assert.equal(computeMissionShiftPx(220, 460, 900), 0);
const topShift = computeMissionShiftPx(900, 460, 900); // entering from bottom -> i = +1 -> shift = -14
assert.ok(Math.abs(topShift - (-14)) < 1e-6, `Expected -14, got ${topShift}`);
const botShift = computeMissionShiftPx(-460, 460, 900); // exiting top -> i = -1 -> shift = +14
assert.ok(Math.abs(botShift - 14) < 1e-6, `Expected +14, got ${botShift}`);

// 4. Test Mecanismo 2: computeFeatureImageShiftPx (--py-img)
// For height=250, factor=0.1 -> max amplitude = 25px
assert.equal(computeFeatureImageShiftPx(325, 250, 900, 0.1), 0);
assert.ok(Math.abs(computeFeatureImageShiftPx(900, 250, 900, 0.1) - (-25)) < 1e-6);
assert.ok(Math.abs(computeFeatureImageShiftPx(-250, 250, 900, 0.1) - 25) < 1e-6);

// 5. Test Mecanismo 5: computeHeroMetrics
const h0 = computeHeroMetrics(0, 900);
assert.equal(h0.progress, 0);
assert.equal(h0.pyHero, 0);
const hMid = computeHeroMetrics(337.5, 900); // half of 0.75*900
assert.ok(Math.abs(hMid.progress - 0.5) < 1e-6);
assert.ok(Math.abs(hMid.pyHero - 337.5 * 0.35) < 1e-6);

// 6. Test Mecanismo 6: computePanelOverlapPx
assert.equal(computePanelOverlapPx(1000, 900), 0); // below viewport
const fullOverlap = computePanelOverlapPx(-200, 900);
assert.ok(Math.abs(fullOverlap - (-0.18 * 900)) < 1e-6);

// 7. Test Mecanismo 3: isNearViewportCenter
assert.equal(isNearViewportCenter(290, 320, 900, 0.26), true);
assert.equal(isNearViewportCenter(850, 320, 900, 0.26), false);

// 8. Test lerp damping
assert.ok(Math.abs(lerp(0, 100, 0.24) - 24) < 1e-6);

// 9. Test damp (frame-rate independent exponential smoothing) and its rates
const expect60 = 100 * (1 - Math.exp(-8 / 60));
assert.ok(Math.abs(damp(0, 100, 8, 1 / 60) - expect60) < 1e-9);
assert.equal(damp(50, 50, 8, 1 / 60), 50);
// Monotonic, never overshoots, converges to the target
let v = 0;
for (let i = 0; i < 600; i++) {
  const nv = damp(v, 100, TRANSFORM_LAMBDA, 1 / 60);
  assert.ok(nv >= v && nv <= 100, "damp must converge monotonically without overshoot");
  v = nv;
}
assert.ok(Math.abs(v - 100) < 0.5, `damp should converge, got ${v}`);
// Invalid dt/lambda fall back to deterministic 60fps defaults (no NaN)
assert.ok(Math.abs(damp(0, 100, TRANSFORM_LAMBDA, 0) - 100 * (1 - Math.exp(-TRANSFORM_LAMBDA / 60))) < 1e-9);
assert.equal(damp(10, 20, 0, 1 / 60), 10 + 10 * (1 - Math.exp(-1 / 60)));
// Same elapsed time produces equal progress regardless of frame rate
let a = 0;
let b = 0;
for (let i = 0; i < 120; i++) a = damp(a, 100, 12, 1 / 120);
for (let i = 0; i < 60; i++) b = damp(b, 100, 12, 1 / 60);
assert.ok(Math.abs(a - b) < 1e-6, `frame-rate independence failed: ${a} vs ${b}`);
assert.ok(TRANSFORM_LAMBDA > 0, "TRANSFORM_LAMBDA must be a positive smoothing rate");

// 10. Footer (PR C) mural math: entry progress, layer drift, staged reveal
// Progress is 0 while the footer is still below the viewport...
assert.equal(computeFooterProgress(900, 1400, 900), 0);
// ...0.5 when half of it has been revealed...
assert.ok(Math.abs(computeFooterProgress(200, 1400, 900) - 0.5) < 1e-9);
// ...and clamps at 1 once the footer bottom reaches the viewport bottom.
assert.equal(computeFooterProgress(-700, 1400, 900), 1);
assert.equal(computeFooterProgress(-5000, 1400, 900), 1);
// Degenerate inputs never produce NaN.
assert.equal(computeFooterProgress(0, 0, 900), 0);
assert.equal(computeFooterProgress(0, -10, 0), 0);

// Layer drift is symmetric around progress 0.5 and bounded by `travel`.
assert.equal(computeFooterLayerOffsetPx(0, 60), 30);
assert.ok(Math.abs(computeFooterLayerOffsetPx(0.5, 60)) < 1e-12);
assert.equal(computeFooterLayerOffsetPx(1, 60), -30);
assert.equal(computeFooterLayerOffsetPx(2, 60), -30);
assert.equal(computeFooterLayerOffsetPx(0.3, undefined), 0);
assert.equal(computeFooterLayerOffsetPx(0.3, NaN), 0);

// Staged reveal: hidden before `at`, linear across `span`, fully revealed after.
assert.equal(computeRevealFactor(0.1, 0.3, 0.2), 0);
assert.ok(Math.abs(computeRevealFactor(0.4, 0.3, 0.2) - 0.5) < 1e-9);
assert.equal(computeRevealFactor(0.5, 0.3, 0.2), 1);
assert.equal(computeRevealFactor(0.9, 0.3, 0.2), 1);
// Zero-width span degrades to a step so the reveal still terminates.
assert.equal(computeRevealFactor(0.29, 0.3, 0), 0);
assert.equal(computeRevealFactor(0.3, 0.3, 0), 1);
// Every reveal stage used by index.html must be reachable inside [0, 1].
assert.equal(computeRevealFactor(1, 0.46, 0.22), 1);

// 11. Static verification of index.html / styles.css / app.js
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");
const css = fs.readFileSync(path.join(dir, "styles.css"), "utf8");
const appSrc = fs.readFileSync(path.join(dir, "app.js"), "utf8");
const assetMatches = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((m) => m[1]);
assert.ok(assetMatches.length >= 25, `Expected at least 25 asset tags, found ${assetMatches.length}`);
assert.ok(assetMatches.includes("favicon-32.png"), "Missing favicon-32.png in index.html");
assert.ok(assetMatches.includes("dnzlfx-avatar.png"), "Missing dnzlfx-avatar.png in index.html");
assert.ok(assetMatches.includes("hero-anime-mono.png") && assetMatches.includes("hero-anime-color.png"), "Missing hero anime plate assets in index.html");
const featureCards = (html.match(/class="landing-feature"/g) || []).length;
assert.equal(featureCards, 4, `Expected 4 project cards, found ${featureCards}`);
for (const banned of ["PROTOTYPE DEMO", "PROTOTYPE NOTICE", "DEMONSTRATION SHOWCASE", "dx-hud", "landing-feature-drift-readout", "nw-mission-index", "nw-art-tag", "dx-eyebrow"]) {
  assert.ok(!html.includes(banned), `index.html still contains banned template marker: ${banned}`);
}
for (const file of assetMatches) {
  const fullPath = path.join(dir, "assets", file);
  assert.ok(fs.existsSync(fullPath), `Missing asset file: ${fullPath}`);
  const stat = fs.statSync(fullPath);
  assert.ok(stat.size > 1000, `Asset file suspiciously small: ${fullPath}`);
}

// 12. Footer markup contract: giant mural, real navigation, accessible name
assert.match(html, /<footer class="dx-footer" id="footer" aria-labelledby="footer-heading">/, "footer must be a labelled landmark");
assert.match(html, /<h2 class="dx-footer-name" id="footer-heading">/, "footer needs its giant name heading");
assert.ok((html.match(/class="dx-footer-name-line"/g) || []).length >= 2, "giant name must be split into reveal lines");
assert.match(html, /<nav class="dx-footer-nav" aria-label="Footer navigation">/, "footer navigation needs an accessible name");
for (const target of ["#top", "#architecture", "#projects", "#about", "#contact"]) {
  assert.ok(html.includes(`href="${target}"`), `footer must link to ${target}`);
}
for (const repo of ["Vyn", "Samantha", "AppealForge", "FoxTube", "Physicsmon-"]) {
  assert.ok(html.includes(`https://github.com/dnzlfx/${repo}"`), `footer must link the real ${repo} repository`);
}
assert.ok(html.includes('href="mailto:guzmanramirezchristian@outlook.com"'), "footer must keep the real contact email");
assert.ok(html.includes('href="https://github.com/dnzlfx"'), "footer must link the GitHub profile");

// The footer mural is a set of transparent artwork layers, never one cropped rectangle.
const footerLayers = [...html.matchAll(/<div class="dx-footer-layer[^"]*"[^>]*data-drift="(\d+)">/g)];
assert.equal(footerLayers.length, 6, `Expected 6 footer mural layers, found ${footerLayers.length}`);
assert.ok(footerLayers.every((m) => Number(m[1]) > 0), "every mural layer needs a drift travel");
for (const layer of ["footer-sky", "footer-spires", "footer-ridge"]) {
  assert.ok(assetMatches.includes(`${layer}-mono.png`), `Missing ${layer}-mono.png binding in index.html`);
  assert.ok(assetMatches.includes(`${layer}-color.png`), `Missing ${layer}-color.png binding in index.html`);
}
assert.ok(!assetMatches.includes("footer-anime-mono.png") && !assetMatches.includes("footer-anime-color.png"), "the old cropped footer plate must be gone from index.html");

// Reveal stages must stay inside the [0, 1] progress range and be ordered.
const revealStages = [...html.matchAll(/data-fr-at="([\d.]+)"/g)].map((m) => Number(m[1]));
assert.ok(revealStages.length >= 6, `Expected staged footer reveal markers, found ${revealStages.length}`);
assert.ok(revealStages.every((s) => s >= 0 && s <= 1), "reveal stages must live in [0, 1]");
assert.ok(revealStages.some((s) => s > 0 && s < 0.2), "the giant name must reveal early in the footer entry");

// Motion is permanent (no visible toggle) and never hijacks the wheel.
assert.ok(!html.includes("motion-toggle"), "the motion toggle button must be gone from index.html");
assert.ok(!html.includes("dx-motion-btn"), "the motion toggle styling hook must be gone from index.html");
assert.ok(!appSrc.includes("WHEEL_LAMBDA"), "the wheel-hijack constant must be gone from app.js");
assert.ok(!/addEventListener\(\s*["']wheel["']/.test(appSrc), "app.js must not listen for wheel events");
assert.ok(!/\.preventDefault\(\)/.test(appSrc), "app.js must never preventDefault (no scroll hijack)");
assert.ok(appSrc.includes('matchMedia("(prefers-reduced-motion: reduce)")'), "app.js must honour prefers-reduced-motion");

// Footer layout contract: taller than the viewport, self-contained responsive rules,
// and a reduced-motion escape hatch for the reveal/drift.
assert.ok(/\.dx-footer\s*\{[^}]*min-height:\s*max\(1[23][0-9]vh/.test(css), ".dx-footer must be taller than one viewport");
assert.ok(/\.dx-footer-name\s*\{[^}]*font-size:\s*clamp\([^)]*vw[^)]*\)/.test(css), ".dx-footer-name must scale with the viewport");
assert.ok(/\.dx-footer-layer img\s*\{[^}]*var\(--dx-footer-drift/.test(css), "mural layers must consume --dx-footer-drift");
assert.ok(/@media \(prefers-reduced-motion: reduce\) \{[^@]*\.dx-footer \[data-fr-at\] \{ opacity: 1 !important; transform: none !important; \}/.test(css), "reduced motion must disable the footer reveal");
assert.ok(/\.dx-footer \[data-fr-at\] \{[^}]*var\(--dx-fr-k/.test(css), "footer reveal must consume --dx-fr-k");

console.log(
  `PASS: All 12 assertion suites (${assetMatches.length} asset bindings, ${footerLayers.length} mural layers, ${revealStages.length} reveal stages) succeeded.`
);
