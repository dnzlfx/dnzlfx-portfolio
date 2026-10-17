/**
 * dnzlfx — Portfolio Scroll & Parallax Engine (Native ES Module / Browser + Node testable)
 * Reimplements the 6 scroll/parallax/reveal mechanisms analyzed in t_c417de8b
 * without hijacking native browser scroll.
 */

export function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/**
 * Compute normalized viewport progress `i` in [-1, 1].
 * When element center aligns with viewport center, i === 0.
 * When element is below viewport center, i > 0; when above, i < 0.
 */
export function computeViewportRatio(rectTop, rectHeight, viewportHeight) {
  const denom = (viewportHeight + rectHeight) / 2;
  if (denom <= 0) return 0;
  const raw = (rectTop + rectHeight / 2 - viewportHeight / 2) / denom;
  return clamp(raw, -1, 1);
}

/**
 * Mecanismo 1 (Nous #mission):
 * --nw-mission-shift = (-i * Math.min(14, 0.035 * h))px
 */
export function computeMissionShiftPx(rectTop, rectHeight, viewportHeight) {
  const i = computeViewportRatio(rectTop, rectHeight, viewportHeight);
  const maxShift = Math.min(14, 0.035 * rectHeight);
  const val = -i * maxShift;
  return val === 0 ? 0 : val;
}

/**
 * Mecanismo 2 (Hermes feature cards & portal):
 * --py-img = (-(i * h * factor))px where factor = 0.1
 */
export function computeFeatureImageShiftPx(rectTop, rectHeight, viewportHeight, factor = 0.1) {
  const i = computeViewportRatio(rectTop, rectHeight, viewportHeight);
  const val = -(i * rectHeight * factor);
  return val === 0 ? 0 : val;
}

/**
 * Mecanismo 5 (Hero fade + blur + lag):
 * --nw-hero-progress in [0, 1] and --py-hero = 0.35 * scrollY
 */
export function computeHeroMetrics(scrollY, viewportHeight) {
  const progress = clamp(scrollY / Math.max(1, viewportHeight * 0.75), 0, 1);
  const pyHero = scrollY * 0.35;
  return { progress, pyHero };
}

/**
 * Mecanismo 6 (Hermes feature panel negative overlap):
 * --py between 0px and -0.18 * viewportHeight as panel enters viewport
 */
export function computePanelOverlapPx(panelRectTop, viewportHeight) {
  const overlapRatio = clamp((viewportHeight - panelRectTop) / Math.max(1, viewportHeight * 1.15), 0, 1);
  const val = -overlapRatio * (viewportHeight * 0.18);
  return val === 0 ? 0 : val;
}

/**
 * Mecanismo 3 (Color reveal proximity check):
 * Returns true when element center is within `thresholdRatio * viewportHeight` of viewport center.
 */
export function isNearViewportCenter(rectTop, rectHeight, viewportHeight, thresholdRatio = 0.28) {
  if (rectHeight <= 0 || viewportHeight <= 0) return false;
  const centerDist = Math.abs(rectTop + rectHeight / 2 - viewportHeight / 2);
  return centerDist < viewportHeight * thresholdRatio;
}

/**
 * Linear interpolation for smooth inertial damping of CSS transforms
 * without hijacking native window scroll.
 */
export function lerp(current, target, alpha) {
  return current + (target - current) * alpha;
}

/**
 * Frame-rate independent exponential damping (critically-damped approach).
 * `lambda` is the smoothing rate in 1/s; `dt` is the frame delta in seconds.
 * Equivalent to lerp(target, 1 - exp(-lambda*dt)), but stable at any refresh rate
 * (60Hz, 120Hz, or dropped frames) so the parallax transforms never stair-step.
 */
export function damp(current, target, lambda, dt) {
  const step = !Number.isFinite(dt) || dt <= 0 ? 1 / 60 : Math.min(dt, 0.1);
  const l = !Number.isFinite(lambda) || lambda <= 0 ? 1 : lambda;
  return current + (target - current) * (1 - Math.exp(-l * step));
}

/** Transform smoothing rate (1/s) — how fast --nw-* / --py-img chase real scroll. */
export const TRANSFORM_LAMBDA = 14;

/**
 * Footer (PR C) — normalized entry progress.
 * 0 when the footer's top edge sits at the viewport bottom, 1 once its bottom
 * edge has reached the viewport bottom. Clamped to [0, 1].
 */
export function computeFooterProgress(rectTop, rectHeight, viewportHeight) {
  if (!(rectHeight > 0)) return 0;
  return clamp((viewportHeight - rectTop) / rectHeight, 0, 1);
}

/**
 * Footer layer drift: `travelPx` is the total vertical travel of one mural layer
 * across the whole footer, symmetric around progress 0.5 (negative = layer rises
 * faster than the page as the footer is entered).
 */
export function computeFooterLayerOffsetPx(progress, travelPx) {
  const p = clamp(progress, 0, 1);
  const travel = Number.isFinite(travelPx) ? travelPx : 0;
  return (0.5 - p) * travel;
}

/**
 * Staged reveal factor for the progressive footer reveal: 0 before `at`,
 * 1 after `at + span`, linear in between (so the giant name uncovers upwards
 * as the footer scrolls into view).
 */
export function computeRevealFactor(progress, at, span) {
  const p = clamp(progress, 0, 1);
  const start = Number.isFinite(at) ? at : 0;
  const width = Number.isFinite(span) && span > 0 ? span : 0;
  if (width === 0) return p >= start ? 1 : 0;
  return clamp((p - start) / width, 0, 1);
}

/**
 * Initialize DOM bindings when running in a real browser environment.
 */
export function initPortfolioScroll() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const root = document.documentElement;
  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");

  // Motion is on by default and stays that way: the ONLY thing that turns it off
  // is the visitor's own OS/browser `prefers-reduced-motion` setting.
  const isReducedMotion = () => motionMedia.matches;

  function syncMotionAttribute() {
    root.setAttribute("data-reduced-motion", isReducedMotion() ? "true" : "false");
  }

  motionMedia.addEventListener("change", () => {
    syncMotionAttribute();
    scheduleTick();
  });
  syncMotionAttribute();

  // Collect animated nodes
  const heroFadeNodes = Array.from(document.querySelectorAll(".nw-hero-fade"));
  const heroParallaxNodes = Array.from(document.querySelectorAll(".hw-hero-parallax"));
  const missionFrames = Array.from(document.querySelectorAll(".nw-mission-hero, .nw-mission-art, .dx-hero-plate"));
  const featurePanelWrap = document.querySelector(".hw-feature-parallax");
  const featureFigures = Array.from(document.querySelectorAll(".landing-feature-art > figure"));
  const revealNodes = Array.from(document.querySelectorAll(".nw-mission-reveal"));
  // Footer (PR C): mural layers drift on scroll, copy reveals in stages.
  const footerEl = document.querySelector(".dx-footer");
  const footerDriftNodes = footerEl ? Array.from(footerEl.querySelectorAll("[data-drift]")) : [];
  const footerRevealNodes = footerEl ? Array.from(footerEl.querySelectorAll("[data-fr-at]")) : [];

  // Mecanismo 4: IntersectionObserver staggered reveal (data-pending removal)
  if ("IntersectionObserver" in window && !isReducedMotion()) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.removeAttribute("data-pending");
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
    );
    for (const node of revealNodes) {
      io.observe(node);
    }
  } else {
    for (const node of revealNodes) {
      node.removeAttribute("data-pending");
    }
  }

  // ---------------------------------------------------------------------------
  // Damped transform state. The document scroll itself is 100% native; only the
  // decorative CSS variables below chase the real scroll position via rAF.
  // ---------------------------------------------------------------------------
  let smoothScrollY = window.scrollY;
  let rafId = 0;
  let lastTs = 0;

  function updateFrame(ts) {
    rafId = 0;
    const now = typeof ts === "number" ? ts : performance.now();
    const dt = lastTs ? (now - lastTs) / 1000 : 1 / 60;
    lastTs = now;

    const vh = window.innerHeight || 1;
    let needMore = false;

    if (isReducedMotion()) {
      smoothScrollY = window.scrollY;
      lastTs = 0;
      for (const el of heroFadeNodes) el.style.setProperty("--nw-hero-progress", "0");
      for (const el of heroParallaxNodes) el.style.setProperty("--py-hero", "0px");
      for (const frame of missionFrames) {
        for (const img of frame.querySelectorAll(".nw-mission-image")) {
          img.style.setProperty("--nw-mission-shift", "0px");
        }
      }
      if (featurePanelWrap) featurePanelWrap.style.setProperty("--py", "0px");
      for (const fig of featureFigures) {
        for (const img of fig.querySelectorAll(".hw-parallax")) {
          img.style.setProperty("--py-img", "0px");
        }
      }
      if (footerEl) {
        footerEl.style.setProperty("--dx-footer-progress", "1");
        footerEl.style.setProperty("--dx-footer-color-k", "1");
        for (const layer of footerDriftNodes) layer.style.setProperty("--dx-footer-drift", "0px");
        for (const node of footerRevealNodes) node.style.setProperty("--dx-fr-k", "1");
      }
      return;
    }

    // 0. Native scroll: the page is never intercepted, so wheel / trackpad /
    //    keyboard / anchors / touch all move the document themselves. Only the
    //    decorative transforms chase the real scroll position (damped below).
    const targetScrollY = window.scrollY;

    // Damped interpolation for silky-smooth variable transforms (no stair-steps
    // on discrete scroll deltas). Frame-rate independent via damp().
    if (Math.abs(targetScrollY - smoothScrollY) <= 0.15) {
      smoothScrollY = targetScrollY;
    } else {
      smoothScrollY = damp(smoothScrollY, targetScrollY, TRANSFORM_LAMBDA, dt);
      needMore = true;
    }
    const scrollOffset = smoothScrollY - targetScrollY;


    // 1. Hero fade + blur + lag parallax (Mecanismo 5)
    const { progress, pyHero } = computeHeroMetrics(smoothScrollY, vh);
    const progStr = progress.toFixed(4);
    const pyHeroStr = `${pyHero.toFixed(2)}px`;
    for (const el of heroFadeNodes) {
      el.style.setProperty("--nw-hero-progress", progStr);
    }
    for (const el of heroParallaxNodes) {
      el.style.setProperty("--py-hero", pyHeroStr);
    }

    // 2. Nous #mission & Hero Plate shift + color reveal (Mecanismo 1 & 3)
    let sampleShift = 0;
    for (let idx = 0; idx < missionFrames.length; idx++) {
      const frame = missionFrames[idx];
      const rect = frame.getBoundingClientRect();
      const effectiveTop = rect.top - scrollOffset;
      const shift = computeMissionShiftPx(effectiveTop, rect.height, vh);
      if (idx === 1 || sampleShift === 0) sampleShift = shift;
      const shiftStr = `${shift.toFixed(2)}px`;

      const imgs = frame.querySelectorAll(".nw-mission-image");
      for (const img of imgs) {
        img.style.setProperty("--nw-mission-shift", shiftStr);
      }

      // Activate purple duotone when passing through viewport center
      if (isNearViewportCenter(effectiveTop, rect.height, vh, 0.26)) {
        frame.setAttribute("data-color-active", "");
      } else {
        frame.removeAttribute("data-color-active");
      }
    }

    // 3. Hermes Feature Panel overlap (Mecanismo 6)
    if (featurePanelWrap) {
      const pRect = featurePanelWrap.getBoundingClientRect();
      const pyOverlap = computePanelOverlapPx(pRect.top - scrollOffset, vh);
      featurePanelWrap.style.setProperty("--py", `${pyOverlap.toFixed(2)}px`);
    }

    // 4. Hermes Feature Card internal parallax + drift readout (Mecanismo 2)
    let samplePyImg = 0;
    for (let idx = 0; idx < featureFigures.length; idx++) {
      const fig = featureFigures[idx];
      const rect = fig.getBoundingClientRect();
      const effectiveTop = rect.top - scrollOffset;
      const pyImg = computeFeatureImageShiftPx(effectiveTop, rect.height, vh, 0.1);
      if (idx === 0) samplePyImg = pyImg;
      const pyImgStr = `${pyImg.toFixed(2)}px`;

      const imgs = fig.querySelectorAll(".hw-parallax");
      for (const img of imgs) {
        img.style.setProperty("--py-img", pyImgStr);
      }

      const artWrap = fig.closest(".landing-feature-art");
      if (artWrap) {
        if (isNearViewportCenter(effectiveTop, rect.height, vh, 0.3)) {
          artWrap.setAttribute("data-color-active", "");
        } else {
          artWrap.removeAttribute("data-color-active");
        }
      }
    }

    // 5. Footer mural (PR C): entry progress drives the layer drift, the purple
    //    duotone cross-fade and the staged reveal of name / nav / sign-off.
    if (footerEl) {
      const fRect = footerEl.getBoundingClientRect();
      const fTop = fRect.top - scrollOffset;
      if (fRect.bottom > -vh && fTop < vh * 2) {
        const footerProgress = computeFooterProgress(fTop, fRect.height, vh);
        footerEl.style.setProperty("--dx-footer-progress", footerProgress.toFixed(4));
        footerEl.style.setProperty(
          "--dx-footer-color-k",
          computeRevealFactor(footerProgress, 0.32, 0.42).toFixed(4)
        );
        for (const layer of footerDriftNodes) {
          const travel = Number(layer.dataset.drift || 0);
          layer.style.setProperty(
            "--dx-footer-drift",
            `${computeFooterLayerOffsetPx(footerProgress, travel).toFixed(2)}px`
          );
        }
        for (const node of footerRevealNodes) {
          const at = Number(node.dataset.frAt);
          const span = Number(node.dataset.frSpan || 0.18);
          node.style.setProperty(
            "--dx-fr-k",
            computeRevealFactor(footerProgress, at, span).toFixed(4)
          );
        }
      }
    }

    // Keep the rAF loop alive while transform damping is still converging
    if (needMore || Math.abs(targetScrollY - smoothScrollY) > 0.15) {
      rafId = window.requestAnimationFrame(updateFrame);
    }
  }

  function scheduleTick() {
    if (!rafId) {
      rafId = window.requestAnimationFrame(updateFrame);
    }
  }

  // No wheel listener, no preventDefault, no scroll animation queue: a fast wheel
  // flick, a trackpad swipe, PageDown, Space or an anchor jump all land instantly
  // and only schedule one frame of decorative transform work. Reduced motion
  // (OS-level) still skips the transforms entirely.
  window.addEventListener("scroll", scheduleTick, { passive: true });
  window.addEventListener("resize", scheduleTick, { passive: true });
  scheduleTick();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initPortfolioScroll);
  } else {
    initPortfolioScroll();
  }
}
