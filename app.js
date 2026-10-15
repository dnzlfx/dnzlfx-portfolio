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
/** Wheel momentum rate (1/s) — Lenis-like inertial page scroll. */
export const WHEEL_LAMBDA = 9;

/**
 * Initialize DOM bindings when running in a real browser environment.
 */
export function initPortfolioScroll() {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const root = document.documentElement;
  const motionMedia = window.matchMedia("(prefers-reduced-motion: reduce)");
  const motionBtn = document.getElementById("motion-toggle");
  const motionLabel = document.getElementById("motion-label");

  // HUD telemetry elements
  const hudScroll = document.getElementById("hud-scroll");
  const hudShift = document.getElementById("hud-shift");
  const hudPyImg = document.getElementById("hud-py-img");

  let manualReduced = false;
  const isReducedMotion = () => manualReduced || motionMedia.matches;

  function syncMotionAttribute() {
    const reduced = isReducedMotion();
    root.setAttribute("data-reduced-motion", reduced ? "true" : "false");
    if (motionLabel) {
      motionLabel.textContent = reduced ? "Motion: Reduced" : "Motion: Fluid";
    }
    if (motionBtn) {
      motionBtn.setAttribute("aria-pressed", reduced ? "true" : "false");
    }
  }

  if (motionBtn) {
    motionBtn.addEventListener("click", () => {
      manualReduced = !isReducedMotion();
      syncMotionAttribute();
      scheduleTick();
    });
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
  // Smooth inertial state (Lenis-like wheel damping + damped CSS-var transforms).
  // Native scroll is preserved: the wheel target is animated onto the real scroll
  // position via rAF, so scrollbar, keyboard, anchors and touch all keep working.
  // ---------------------------------------------------------------------------
  let smoothScrollY = window.scrollY;
  let rafId = 0;
  let lastTs = 0;
  let wheelTarget = window.scrollY;
  let wheelActive = false;

  const maxScrollY = () =>
    Math.max(0, (document.documentElement.scrollHeight || 0) - (window.innerHeight || 0));

  // Do not hijack wheel gestures aimed at a genuinely scrollable child element.
  function isInsideScrollable(node) {
    let el = node instanceof Element ? node : null;
    while (el && el !== document.body && el !== root) {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) return true;
      el = el.parentElement;
    }
    return false;
  }

  function updateFrame(ts) {
    rafId = 0;
    const now = typeof ts === "number" ? ts : performance.now();
    const dt = lastTs ? (now - lastTs) / 1000 : 1 / 60;
    lastTs = now;

    const vh = window.innerHeight || 1;
    let needMore = false;

    if (isReducedMotion()) {
      smoothScrollY = window.scrollY;
      wheelTarget = smoothScrollY;
      wheelActive = false;
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
      if (hudScroll) hudScroll.textContent = `${Math.round(window.scrollY)}px`;
      if (hudShift) hudShift.textContent = "0.0px";
      if (hudPyImg) hudPyImg.textContent = "0.0px";
      return;
    }

    // 0. Lenis-like inertial wheel scrolling: animate the real scroll position
    //    towards the accumulated wheel target with frame-rate independent damping.
    if (wheelActive) {
      wheelTarget = clamp(wheelTarget, 0, maxScrollY());
      const cur = window.scrollY;
      const next = damp(cur, wheelTarget, WHEEL_LAMBDA, dt);
      if (Math.abs(wheelTarget - next) < 0.4) {
        if (Math.abs(wheelTarget - cur) > 0.01) window.scrollTo(0, wheelTarget);
        wheelActive = false;
      } else {
        window.scrollTo(0, next);
        needMore = true;
      }
    }

    const targetScrollY = window.scrollY;

    // Damped interpolation for silky-smooth variable transforms (no stair-steps
    // on discrete wheel jumps). Frame-rate independent via damp().
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

      const card = fig.closest(".landing-feature");
      if (card) {
        const readout = card.querySelector(".landing-feature-drift-readout");
        if (readout) {
          readout.textContent = `py: ${pyImg >= 0 ? "+" : ""}${pyImg.toFixed(1)}px`;
        }
      }
    }

    // Update live HUD
    if (hudScroll) hudScroll.textContent = `${Math.round(smoothScrollY)}px`;
    if (hudShift) hudShift.textContent = `${sampleShift >= 0 ? "+" : ""}${sampleShift.toFixed(1)}px`;
    if (hudPyImg) hudPyImg.textContent = `${samplePyImg >= 0 ? "+" : ""}${samplePyImg.toFixed(1)}px`;

    // Keep the rAF loop alive while wheel momentum or transform damping is converging
    if (needMore || Math.abs(targetScrollY - smoothScrollY) > 0.15) {
      rafId = window.requestAnimationFrame(updateFrame);
    }
  }

  function scheduleTick() {
    if (!rafId) {
      rafId = window.requestAnimationFrame(updateFrame);
    }
  }

  // Lenis-like wheel damping. Ctrl/Cmd+wheel (pinch zoom) and nested scrollable
  // containers are left to the browser; reduced motion disables it entirely.
  window.addEventListener(
    "wheel",
    (e) => {
      if (isReducedMotion() || e.ctrlKey || e.metaKey || e.cancelable === false) return;
      if (isInsideScrollable(e.target)) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight || 1 : 1;
      const next = clamp(wheelTarget + e.deltaY * unit, 0, maxScrollY());
      e.preventDefault();
      wheelTarget = next;
      wheelActive = true;
      scheduleTick();
    },
    { passive: false }
  );

  window.addEventListener(
    "scroll",
    () => {
      // Re-sync when the scroll was native/programmatic (scrollbar, keyboard, anchors)
      if (!wheelActive) wheelTarget = window.scrollY;
      scheduleTick();
    },
    { passive: true }
  );
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
