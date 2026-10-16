#!/usr/bin/env node
/**
 * Self-contained verification test suite for dnzlfx-portfolio-demo scroll & parallax math.
 *
 * The test resolves its own directory from import.meta.url so it always validates the
 * checkout it lives in (no hardcoded absolute path). Run with: node test_scroll_math.mjs
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
  isNearViewportCenter,
  lerp,
  damp,
  TRANSFORM_LAMBDA,
  WHEEL_LAMBDA,
} from "./app.js";

// Native URL -> path conversion for the file that is actually running. Resolves the real
// branch tree being tested instead of whatever checkout happens to sit at a fixed path.
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
assert.ok(WHEEL_LAMBDA > 0 && TRANSFORM_LAMBDA > WHEEL_LAMBDA);

// 10. Verify the real project showcase markup and every referenced asset in index.html.
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

// 10a. Exactly three project cards, counted SEMANTICALLY. The old
// /class="landing-feature"/g regex undercounted them because the featured card is
// `class="landing-feature landing-feature--featured"`, so it matched only 2. Count
// real <article class="landing-feature..."> elements instead.
const featureCards = [...html.matchAll(/<article class="landing-feature[^"]*">[\s\S]*?<\/article>/g)];
assert.equal(featureCards.length, 3, `Expected exactly 3 project cards, found ${featureCards.length}`);

// 10b. Those cards must link EXACTLY the real set of project repositories -- no
// missing links, no unexpected extras.
const expectedRepos = new Set([
  "https://github.com/dnzlfx/Vyn",
  "https://github.com/dnzlfx/Samantha",
  "https://github.com/dnzlfx/Impact_Forge-AppealForge",
  "https://github.com/dnzlfx/FoxTube",
]);
const cardLinks = new Set();
for (const [block] of featureCards) {
  for (const m of block.matchAll(/href="(https:\/\/github\.com\/dnzlfx\/[^"]+)"/g)) {
    cardLinks.add(m[1]);
  }
}
const missingRepos = [...expectedRepos].filter((u) => !cardLinks.has(u));
const extraRepos = [...cardLinks].filter((u) => !expectedRepos.has(u));
assert.deepEqual(missingRepos, [], `Project cards are missing repo links: ${missingRepos.join(", ")}`);
assert.deepEqual(extraRepos, [], `Project cards link unexpected repos: ${extraRepos.join(", ")}`);

// 10c. No template/debug chrome may survive in the shipped markup.
for (const banned of ["PROTOTYPE DEMO", "PROTOTYPE NOTICE", "DEMONSTRATION SHOWCASE", "dx-hud", "landing-feature-drift-readout", "nw-mission-index", "nw-art-tag", "dx-eyebrow"]) {
  assert.ok(!html.includes(banned), `index.html still contains banned template marker: ${banned}`);
}

// 10d. Asset integrity. Every ./assets/... reference must resolve to a real file on
// disk larger than 1000 bytes -- checked individually, never as a loose ">= N".
const assetMatches = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+)"/g)].map((m) => m[1]);
assert.equal(assetMatches.length, 23, `Expected exactly 23 asset references, found ${assetMatches.length}`);

// Assets that must ship regardless of how the markup links them.
const requiredAssets = [
  "favicon-32.png",
  "dnzlfx-avatar.png",
  "hero-anime-mono.png",
  "hero-anime-color.png",
  "footer-anime-mono.png",
  "footer-anime-color.png",
  "feature-vyn-mono.png",
  "feature-vyn-color.png",
  "feature-samantha-mono.png",
  "feature-samantha-color.png",
  "feature-appealforge-mono.png",
  "feature-appealforge-color.png",
  "feature-foxtube-mono.png",
  "feature-foxtube-color.png",
];
for (const file of requiredAssets) {
  const fullPath = path.join(dir, "assets", file);
  assert.ok(fs.existsSync(fullPath), `Missing required asset file: ${fullPath}`);
  const stat = fs.statSync(fullPath);
  assert.ok(stat.size > 1000, `Asset file suspiciously small: ${fullPath} (${stat.size} bytes)`);
}
// The assets the markup actually references must be among what index.html links.
for (const file of ["favicon-32.png", "dnzlfx-avatar.png", "hero-anime-mono.png", "hero-anime-color.png", "footer-anime-mono.png", "footer-anime-color.png"]) {
  assert.ok(assetMatches.includes(file), `index.html does not reference expected asset: ${file}`);
}
// Every referenced asset must exist on disk and be > 1000 bytes.
for (const file of assetMatches) {
  const fullPath = path.join(dir, "assets", file);
  assert.ok(fs.existsSync(fullPath), `Missing asset file: ${fullPath}`);
  const stat = fs.statSync(fullPath);
  assert.ok(stat.size > 1000, `Asset file suspiciously small: ${fullPath} (${stat.size} bytes)`);
}

console.log(`PASS: All 10 assertion suites (${featureCards.length} project cards, ${assetMatches.length} asset bindings) succeeded.`);
