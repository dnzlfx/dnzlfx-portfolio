#!/usr/bin/env python3
"""Generate original artwork for the dnzlfx portfolio.

Two families of art:
  1. Anime-aesthetic character plates (hero bust + footer panorama), rendered as
     cel-shaded line engravings and then reduced with an 8x8 Bayer ordered-dither
     into a monochrome silver palette and an electric-purple duotone palette.
  2. Editorial / project plates (panoramic mission header + paired row art +
     project card art) in the same dithered house style.

Everything is drawn procedurally with Pillow primitives (Bezier polylines,
polygons, arcs) - no external image assets are used or required.
"""
import math
import os

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

OUT_DIR = "/mnt/datos/proyectos/dnzlfx-portfolio-demo/assets"
os.makedirs(OUT_DIR, exist_ok=True)

BASE_BG = (7, 6, 11)  # #07060B page background, used for the edge fade-out

BAYER_8 = [
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
]


# ---------------------------------------------------------------------------
# Ordered dithering + palettes
# ---------------------------------------------------------------------------
def apply_bayer_dither(gray_img, palette_levels, pixel_scale: int = 2) -> Image.Image:
    """Downsample, apply 8x8 Bayer ordered dithering across palette_levels, upscale."""
    w, h = gray_img.size
    sw, sh = max(1, w // pixel_scale), max(1, h // pixel_scale)
    small = gray_img.resize((sw, sh), Image.Resampling.BILINEAR)
    px = small.load()

    # Precompute a 255-entry -> palette index/frac lookup so the inner loop is cheap.
    n_pal = len(palette_levels) - 1
    out = Image.new("RGB", (sw, sh))
    opx = out.load()
    for y in range(sh):
        row = BAYER_8[y & 7]
        for x in range(sw):
            v = px[x, y]
            scaled = v * n_pal / 255.0
            idx = int(scaled)
            frac = scaled - idx
            if frac > (row[x & 7] + 0.5) / 64.0 and idx < n_pal:
                idx += 1
            opx[x, y] = palette_levels[idx]
    return out.resize((w, h), Image.Resampling.NEAREST)


# Mono: deep void -> slate -> muted lavender -> silver -> starlight white
PAL_MONO = [
    (7, 6, 11),       # #07060B void black
    (42, 37, 60),     # dark slate violet
    (108, 100, 134),  # mid muted lavender
    (184, 176, 212),  # silver
    (243, 240, 252),  # starlight white
]

# Color: electric purple duotone (#6D28D9 / #A855F7 / #C084FC) over #07060B
PAL_COLOR = [
    (7, 6, 11),       # #07060B void black
    (109, 40, 217),   # #6D28D9 deep royal purple
    (168, 85, 247),   # #A855F7 electric purple
    (192, 132, 252),  # #C084FC vivid lavender
    (243, 240, 252),  # bright starlight
]


def fade_gray_to_bg(gray_img: Image.Image, hold: float = 0.62, feather: float = 1.0,
                    bg_level: int = 7, bottom: float = 0.86) -> Image.Image:
    """Fade a greyscale plate into the page background *before* dithering.

    Doing this in the grey domain (instead of blending two already-dithered RGB
    plates) keeps the ordered dither genuinely 1-to-5 levels: no smooth alpha
    ramps survive, so the halftone stays crisp and uniform right to the edges.
    """
    w, h = gray_img.size
    # 0 at the centre, 255 at the edge mid-points: opaque core, faded rim.
    mask = Image.radial_gradient("L").resize((w, h), Image.Resampling.BILINEAR)

    def falloff(v: int) -> int:
        t = v / 255.0
        if t <= hold:
            return 255
        if t >= feather:
            return 0
        u = (t - hold) / (feather - hold)
        u = u * u * (3 - 2 * u)  # smoothstep
        return int(255 * (1 - u))

    mask = mask.point(falloff)
    if bottom < 1.0:
        grad = Image.new("L", (w, h), 255)
        gd = ImageDraw.Draw(grad)
        for y in range(int(h * bottom), h):
            t = (y - h * bottom) / (h * (1 - bottom))
            gd.line([(0, y), (w, y)], fill=int(255 * (1 - t * t)))
        mask = ImageChops.multiply(mask, grad)
    return Image.composite(gray_img, Image.new("L", (w, h), bg_level), mask)


def save_plate(gray_img: Image.Image, prefix: str, pixel_scale: int = 2,
               colors: bool = True, fade: bool = True):
    g = fade_gray_to_bg(gray_img) if fade else gray_img
    mono = apply_bayer_dither(g, PAL_MONO, pixel_scale)
    mono.save(os.path.join(OUT_DIR, f"{prefix}-mono.png"), optimize=True)
    if not colors:
        return
    color = apply_bayer_dither(g, PAL_COLOR, pixel_scale)
    color.save(os.path.join(OUT_DIR, f"{prefix}-color.png"), optimize=True)


# ---------------------------------------------------------------------------
# Drawing primitives
# ---------------------------------------------------------------------------
def bez(p0, p1, p2, p3, n=64):
    """Sample a cubic Bezier into a list of (x, y) points."""
    pts = []
    for i in range(n + 1):
        t = i / n
        mt = 1 - t
        x = mt**3 * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t**3 * p3[0]
        y = mt**3 * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t**3 * p3[1]
        pts.append((x, y))
    return pts


def strand_poly(spine, w_base, w_tip):
    """Offset a spine polyline into a tapered filled polygon (a hair lock)."""
    n = len(spine)
    left, right = [], []
    for i, (x, y) in enumerate(spine):
        t = i / (n - 1)
        if i == 0:
            dx, dy = spine[1][0] - x, spine[1][1] - y
        elif i == n - 1:
            dx, dy = x - spine[-2][0], y - spine[-2][1]
        else:
            dx, dy = spine[i + 1][0] - spine[i - 1][0], spine[i + 1][1] - spine[i - 1][1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        w = (w_base * (1 - t) + w_tip * t) / 2.0
        left.append((x + nx * w, y + ny * w))
        right.append((x - nx * w, y - ny * w))
    return left + right[::-1]


def starburst(d, cx, cy, r_in, r_out, count, color, width=1):
    for i in range(count):
        ang = (2 * math.pi * i) / count
        x1 = cx + math.cos(ang) * r_in
        y1 = cy + math.sin(ang) * r_in
        x2 = cx + math.cos(ang) * r_out
        y2 = cy + math.sin(ang) * r_out
        d.line([(x1, y1), (x2, y2)], fill=color, width=width)


def spark(d, cx, cy, r, color=250, width=2):
    """Four-point sparkle."""
    starburst(d, cx, cy, 0, r, 4, color, width=width)
    d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=255)


def radial_glow(img: Image.Image, cx, cy, radius, aspect=1.0, peak=90, blur=42) -> Image.Image:
    w, h = img.size
    glow = Image.new("L", (w, h), 0)
    gd = ImageDraw.Draw(glow)
    steps = 60
    for i in range(steps, 0, -1):
        r = radius * i / steps
        val = int(peak * (1 - i / float(steps)) ** 1.4)
        gd.ellipse([cx - r, cy - r * aspect, cx + r, cy + r * aspect], fill=val)
    glow = glow.filter(ImageFilter.GaussianBlur(blur))
    return ImageChops.add(img, glow, scale=1.0, offset=0)


def engraving_sphere(d, cx, cy, radius, light=(-0.5, -0.6, 0.6)):
    lx, ly, lz = light
    n = math.sqrt(lx * lx + ly * ly + lz * lz)
    lx, ly, lz = lx / n, ly / n, lz / n
    for r in range(int(radius), 0, -2):
        for a in range(0, 360, 4):
            rad = math.radians(a)
            nx = (r / radius) * math.cos(rad)
            ny = (r / radius) * math.sin(rad)
            nz = math.sqrt(max(0.0, 1.0 - nx * nx - ny * ny))
            dot = max(0.0, nx * lx + ny * ly + nz * lz)
            val = int(30 + 225 * (dot ** 1.3))
            d.point((cx + nx * radius, cy + ny * radius), fill=val)


# ---------------------------------------------------------------------------
# Anime bust (hero)
# ---------------------------------------------------------------------------
def draw_anime_bust(d, W, H):
    """Front-facing anime bust: flowing hair, expressive cel eyes, over-ear
    cyber-acoustic studio headset, high-collar coat and acoustic waves."""
    cx = W / 2
    head_cy = 452
    chin = 648
    face_hw = 176
    eye_y = 478
    eye_dx = 90

    OUT = 10           # outline near-black
    HAIR_DK = 34
    HAIR_MID = 86
    HAIR_HI = 236
    SKIN = 218
    SKIN_SH = 170
    SKIN_LN = 104
    COAT = 24
    COAT_MID = 60
    COAT_LN = 150
    WHITE = 252

    # ---- Astral halo rings ----------------------------------------------
    for r, col in [(424, 52), (372, 36)]:
        d.ellipse([cx - r, head_cy - r * 1.06, cx + r, head_cy + r * 1.06],
                  outline=col, width=2)
    for i in range(64):
        a = 2 * math.pi * i / 64
        rr = 452
        d.ellipse([cx + math.cos(a) * rr - 3, head_cy + math.sin(a) * rr * 1.05 - 3,
                   cx + math.cos(a) * rr + 3, head_cy + math.sin(a) * rr * 1.05 + 3], fill=105)

    # ---- Back hair (dark mass behind everything) -------------------------
    back = (bez((cx - 268, 480), (cx - 336, 250), (cx - 220, 232), (cx - 70, 258), 40)
            + bez((cx - 70, 258), (cx + 120, 236), (cx + 336, 250), (cx + 274, 480), 40)
            + bez((cx + 274, 480), (cx + 322, 660), (cx + 268, 800), (cx + 220, 884), 30)
            + bez((cx + 220, 884), (cx + 120, 918), (cx - 120, 918), (cx - 224, 884), 30)
            + bez((cx - 224, 884), (cx - 272, 800), (cx - 324, 660), (cx - 268, 480), 30))
    d.polygon(back, fill=HAIR_DK)
    # a single broad inner strand for depth (thin repeated lines read as noise)
    d.polygon(bez((cx - 236, 600), (cx - 252, 764), (cx - 208, 868), (cx - 140, 900), 26)
              + bez((cx - 140, 900), (cx - 84, 884), (cx - 122, 720), (cx - 158, 548), 26),
              fill=52)

    # ---- Neck ------------------------------------------------------------
    d.polygon([(cx - 60, 592), (cx + 60, 592), (cx + 72, 724), (cx - 72, 724)], fill=SKIN_SH)
    # shadow under the jaw
    d.polygon(bez((cx - 66, 616), (cx, 664), (cx + 66, 616), (cx + 60, 596), 16)
              + [(cx - 60, 596)], fill=120)

    # ---- Shoulders + long coat ------------------------------------------
    d.polygon(bez((cx - 94, 702), (cx - 330, 752), (cx - 436, 900), (cx - 452, H), 24)
              + [(cx + 452, H)]
              + bez((cx + 452, H), (cx + 436, 900), (cx + 330, 752), (cx + 94, 702), 24),
              fill=54)
    # bright rims along both shoulder lines so the bust sits on a real body
    d.line(bez((cx - 94, 702), (cx - 330, 752), (cx - 436, 900), (cx - 452, H), 24),
           fill=182, width=5)
    d.line(bez((cx + 94, 702), (cx + 330, 752), (cx + 436, 900), (cx + 452, H), 24),
           fill=182, width=5)
    # coat opening: a narrow dark V so the chest reads (no flat column)
    d.polygon([(cx - 76, 712), (cx + 76, 712), (cx + 36, H), (cx - 36, H)], fill=22)
    # high collar sweeping up behind the jaw
    d.polygon(bez((cx - 84, 714), (cx - 236, 672), (cx - 204, 566), (cx - 104, 600), 20)
              + bez((cx - 104, 600), (cx - 66, 610), (cx - 46, 628), (cx - 44, 714), 12)
              + [(cx + 44, 714)]
              + bez((cx + 44, 714), (cx + 46, 628), (cx + 66, 610), (cx + 104, 600), 12)
              + bez((cx + 104, 600), (cx + 204, 566), (cx + 236, 672), (cx + 84, 714), 20),
              fill=112)
    for s in (-1, 1):
        d.line(bez((cx + s * 84, 714), (cx + s * 236, 672), (cx + s * 204, 566), (cx + s * 104, 600), 20),
               fill=196, width=5)
    # lapels
    d.line([(cx - 44, 714), (cx - 150, H)], fill=COAT_LN, width=4)
    d.line([(cx + 44, 714), (cx + 158, H)], fill=COAT_LN, width=4)

    # ---- Face ------------------------------------------------------------
    face = (bez((cx - face_hw, 456), (cx - face_hw - 4, 572), (cx - 108, 646), (cx, chin), 30)
            + bez((cx, chin), (cx + 108, 646), (cx + face_hw + 4, 572), (cx + face_hw, 456), 30)
            + bez((cx + face_hw, 456), (cx + 132, 322), (cx - 132, 322), (cx - face_hw, 456), 30))
    d.polygon(face, fill=SKIN)
    # soft cheek shadow on the left (light from upper right)
    d.polygon(bez((cx - face_hw + 6, 520), (cx - 122, 560), (cx - 152, 612), (cx - 98, 638), 18)
              + [(cx, chin), (cx - face_hw + 6, 520)], fill=SKIN_SH)
    # bangs shadow band across the forehead
    d.polygon(bez((cx - face_hw, 452), (cx - 40, 514), (cx + 60, 502), (cx + face_hw, 448), 24)
              + [(cx + face_hw, 384), (cx - face_hw, 384)], fill=SKIN_SH)

    # ---- Eyes ------------------------------------------------------------
    for s in (-1, 1):
        ex, ey = cx + s * eye_dx, eye_y
        upper = bez((ex - 62, ey + 8), (ex - 22, ey - 50), (ex + 24, ey - 50), (ex + 64, ey + 2), 28)
        lower = bez((ex + 64, ey + 2), (ex + 22, ey + 38), (ex - 22, ey + 38), (ex - 62, ey + 8), 28)
        d.polygon(upper + lower, fill=WHITE)
        ir = 33
        d.ellipse([ex - ir, ey - ir + 2, ex + ir, ey + ir + 2], fill=HAIR_MID)
        d.ellipse([ex - ir + 7, ey - ir + 11, ex + ir - 7, ey + ir - 5], fill=HAIR_DK)
        d.ellipse([ex - 13, ey - 13, ex + 13, ey + 13], fill=OUT)
        d.ellipse([ex - 18, ey - 20, ex + 4, ey + 2], fill=WHITE)
        d.ellipse([ex + 8, ey + 10, ex + 19, ey + 21], fill=WHITE)
        d.line(upper, fill=OUT, width=12, joint="curve")
        d.line([(ex + s * 62, ey + 2), (ex + s * 76, ey - 12)], fill=OUT, width=9)
        d.line(lower, fill=SKIN_LN, width=3, joint="curve")
        d.line(bez((ex - 56, ey - 66), (ex - 12, ey - 88), (ex + 26, ey - 84), (ex + 60, ey - 64), 18),
               fill=OUT, width=7, joint="curve")

    # ---- Nose + mouth ----------------------------------------------------
    d.line([(cx + 5, 556), (cx + 1, 572)], fill=SKIN_LN, width=4)
    d.line(bez((cx - 32, 602), (cx, 616), (cx + 32, 600), (cx + 10, 594), 14), fill=OUT, width=5)

    # ---- Front bangs (mid tone so they separate from the dark back hair) --
    for p in [
        ((cx - 224, 296), (cx - 268, 452), (cx - 200, 556), (cx - 158, 462)),
        ((cx - 164, 262), (cx - 226, 400), (cx - 160, 522), (cx - 116, 434)),
        ((cx - 86, 242), (cx - 150, 372), (cx - 100, 502), (cx - 48, 414)),
        ((cx + 0, 236), (cx - 44, 356), (cx - 12, 492), (cx + 44, 406)),
        ((cx + 88, 244), (cx + 44, 362), (cx + 84, 496), (cx + 136, 412)),
        ((cx + 166, 262), (cx + 130, 396), (cx + 182, 520), (cx + 224, 430)),
        ((cx + 226, 296), (cx + 208, 448), (cx + 262, 552), (cx + 280, 448)),
    ]:
        d.polygon(strand_poly(bez(*p), 42, 8), fill=HAIR_MID)
    # crown cap over the scalp
    d.polygon(bez((cx - 200, 452), (cx - 160, 288), (cx + 160, 288), (cx + 200, 452), 30)
              + [(cx + 160, 452), (cx - 160, 452)], fill=HAIR_MID)
    # one broad, sweeping highlight across the crown (follows the hair flow)
    d.line(bez((cx - 150, 330), (cx - 40, 300), (cx + 70, 306), (cx + 158, 336), 26),
           fill=HAIR_HI, width=6, joint="curve")
    # side locks framing the jaw
    for s in (-1, 1):
        spine = bez((cx + s * 214, 386), (cx + s * 268, 560), (cx + s * 246, 730), (cx + s * 204, 862), 30)
        d.polygon(strand_poly(spine, 46, 12), fill=HAIR_DK)
        d.line(spine, fill=104, width=3, joint="curve")
    # crisp silhouette outline so the hair reads clearly against the halo
    d.line(back + [back[0]], fill=132, width=4, joint="curve")

    # ---- Over-ear cyber-acoustic headset ---------------------------------
    band = bez((cx - 206, 462), (cx - 200, 226), (cx + 200, 226), (cx + 206, 462), 30)
    d.line(band, fill=COAT_MID, width=22, joint="curve")
    d.line(band, fill=COAT_LN, width=4, joint="curve")
    for s in (-1, 1):
        hx, hy = cx + s * 210, 512
        d.line([(hx, hy - 96), (cx + s * 202, 452)], fill=COAT_MID, width=14)   # yoke
        d.ellipse([hx - 70, hy - 100, hx + 70, hy + 100], fill=COAT)            # shell (tall)
        d.ellipse([hx - 70, hy - 100, hx + 70, hy + 100], outline=COAT_LN, width=4)
        d.ellipse([hx - 46, hy - 70, hx + 46, hy + 70], fill=COAT_MID)          # pad
        a0, a1 = (40, 320) if s > 0 else (220, 140)
        d.arc([hx - 62, hy - 92, hx + 62, hy + 92], a0, a1, fill=HAIR_HI, width=5)  # rim highlight
        b0, b1 = (20, 340) if s > 0 else (200, 160)
        d.arc([hx - 30, hy - 48, hx + 30, hy + 48], b0, b1, fill=110, width=2)

    # ---- Acoustic waves from the ear cups --------------------------------
    for k, r in enumerate((120, 168, 216, 264)):
        d.arc([cx + 210 - r, 512 - r, cx + 210 + r, 512 + r], 300, 60, fill=70 + k * 44, width=3)
    for k, r in enumerate((120, 168, 216)):
        d.arc([cx - 210 - r, 512 - r, cx - 210 + r, 512 + r], 120, 240, fill=70 + k * 44, width=3)

    # ---- Code sparks, kept clear of the face ----------------------------
    for (sx, sy, r) in [(140, 232, 14), (760, 262, 18), (118, 620, 10), (782, 660, 12)]:
        spark(d, sx, sy, r, color=235, width=2)


def local_lift(gray_img: Image.Image, cx: float, cy: float, rx: float, ry: float,
               amount: float = 55.0) -> Image.Image:
    """Softly open up one region of a greyscale plate before dithering.

    Used to rescue facial features that a source illustration renders in very deep
    shadow: with only five dither levels, a near-black nose/mouth zone collapses
    into a featureless blob. The lift is strongest in the darks and fades to zero
    at white, so nothing clips.
    """
    w, h = gray_img.size
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).ellipse(
        [w * (cx - rx), h * (cy - ry), w * (cx + rx), h * (cy + ry)], fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(radius=max(4.0, min(w * rx, h * ry) * 0.22)))
    def _up(v: int) -> int:
        nv = v + amount * (1 - v / 255.0)
        return 255 if nv >= 255 else int(nv)

    lifted = gray_img.point(_up)
    return Image.composite(lifted, gray_img, mask)


def _clamp(v: float) -> int:
    """Clamp a channel value into 0..255 (kept as a named fn to keep point() typing clean)."""
    return 0 if v < 0 else (255 if v > 255 else int(v))


def plate_from_source(src_name: str, prefix: str, size=None, pixel_scale: int = 3,
                      contrast: float = 1.18, gamma: float = 1.0, lift=None,
                      gain: float = 1.0) -> bool:
    """Post-process a generated illustration into the house Bayer duotone.

    Loads ``assets/raw/<src_name>``, converts to greyscale, lifts contrast, then
    runs it through the shared ordered-dither pipeline (mono silver + electric
    purple duotone) with a soft fade into #07060B. Returns False when the source
    is missing so callers can fall back to the procedural renderer.
    """
    src = os.path.join(OUT_DIR, "raw", src_name)
    if not os.path.exists(src):
        return False
    im = Image.open(src).convert("RGB")
    if size:
        im = ImageOps.fit(im, size, Image.Resampling.LANCZOS, centering=(0.5, 0.46))
    g: Image.Image = ImageOps.autocontrast(im.convert("L"), cutoff=1)

    def _curve(v: int) -> int:
        x = float(v) * gain
        if gamma != 1.0:
            x = 255.0 * ((_clamp(x) / 255.0) ** gamma)
        return _clamp((x - 128.0) * contrast + 128.0)

    g = g.point([_curve(v) for v in range(256)])
    if lift:
        g = local_lift(g, *lift)
    save_plate(g, prefix, pixel_scale=pixel_scale)
    return True


def make_anime_bust():
    # Primary path: a generated illustration reduced to the Bayer purple duotone.
    if plate_from_source("hero-src.png", "hero-anime", size=(1024, 1536), pixel_scale=3,
                         gain=0.82, contrast=1.0):
        return
    # Fallback: procedural render (kept so the set always regenerates offline).
    W, H = 900, 1100
    base = Image.new("L", (W, H), 9)
    bd = ImageDraw.Draw(base)
    for y in range(H):
        t = y / H
        bd.line([(0, y), (W, y)], fill=int(9 + 14 * (1 - t)))
    base = radial_glow(base, W / 2, 430, 620, aspect=1.12, peak=104, blur=82)
    d = ImageDraw.Draw(base)
    draw_anime_bust(d, W, H)
    base = base.filter(ImageFilter.GaussianBlur(radius=0.5))
    save_plate(base, "hero-anime")
    save_plate(base, "hero-totem")


# ---------------------------------------------------------------------------
# Anime panorama (footer)
# ---------------------------------------------------------------------------
def draw_anime_mural(d, W, H):
    """Panoramic back-view figure gazing at a night horizon of acoustic waves,
    code constellations and luminous monoliths."""
    OUT = 10
    HAIR_BASE = 34
    HAIR_MID = 80
    HAIR_HI = 236
    COAT = 26
    COAT_MID = 56
    COAT_LN = 150
    WHITE = 250
    horizon = 452

    fx = 500            # figure x
    head_cy = 300       # figure head centre

    # --- distant monoliths on the horizon (small, grounded, far right) ----
    def monolith(mx, mw, mh):
        d.rectangle([mx, horizon - mh, mx + mw, horizon], fill=26)
        d.rectangle([mx, horizon - mh, mx + mw, horizon], outline=205, width=2)
        for k in range(1, 4):
            yy = horizon - mh + k * mh / 4.0
            d.line([(mx + 8, yy), (mx + mw - 8, yy)], fill=170, width=1)
        d.rectangle([mx + mw // 2 - 3, horizon - mh + 4, mx + mw // 2 + 3, horizon - mh + 12], fill=240)

    monolith(1180, 96, 196)
    monolith(1310, 74, 150)
    monolith(1060, 58, 118)

    # --- night sky gradient ----------------------------------------------
    for y in range(0, horizon):
        t = y / horizon
        d.line([(0, y), (W, y)], fill=int(9 + 20 * (t ** 2.2)))

    # --- monoliths sit ON the horizon, so draw them after the sky ---------
    monolith(1180, 96, 196)
    monolith(1310, 74, 150)
    monolith(1060, 58, 118)

    # --- crisp horizon line ----------------------------------------------
    d.line([(0, horizon), (W, horizon)], fill=232, width=3)
    d.line([(0, horizon + 4), (W, horizon + 4)], fill=120, width=2)

    # --- acoustic wave rings rising from behind the horizon ---------------
    gx, gy = 940, horizon
    for k, r in enumerate((520, 440, 366, 296, 230, 168)):
        col = int(52 + k * 34)
        d.arc([gx - r, gy - r * 0.60, gx + r, gy + r * 0.60], 188, 352, fill=col, width=3)

    # --- ground: a lit plane fading into darkness -------------------------
    for y in range(horizon + 4, H):
        t = (y - horizon) / float(H - horizon)
        d.line([(0, y), (W, y)], fill=int(148 * (1 - t) ** 1.7 + 10))
    for i in range(1, 14):
        t = (i / 13.0) ** 1.8
        py = int(horizon + t * (H - horizon))
        d.line([(0, py), (W, py)], fill=int(24 + 120 * (1 - t) ** 2), width=2 if t < 0.45 else 1)
    vpx = 940
    for i in range(-26, 27):
        d.line([(vpx, horizon), (vpx + i * 150, H)], fill=82 if i % 3 == 0 else 44, width=1)

    # --- the figure (back view): lit head, dark coat, bright rim ----------
    coat = (bez((fx - 58, 398), (fx - 202, 442), (fx - 256, 566), (fx - 266, H), 22)
            + [(fx + 266, H)]
            + bez((fx + 266, H), (fx + 256, 566), (fx + 202, 442), (fx + 58, 398), 22))
    d.polygon(coat, fill=20)
    # rim light on both edges of the coat
    d.line(bez((fx - 58, 398), (fx - 202, 442), (fx - 256, 566), (fx - 266, H), 22),
           fill=188, width=5)
    d.line(bez((fx + 58, 398), (fx + 202, 442), (fx + 256, 566), (fx + 266, H), 22),
           fill=188, width=5)
    # neck
    d.polygon([(fx - 32, 348), (fx + 32, 348), (fx + 36, 406), (fx - 36, 406)], fill=152)
    # collar
    d.polygon([(fx - 78, 392), (fx + 78, 392), (fx + 58, 458), (fx - 58, 458)], fill=66)
    # head: hair mass (back view) with a shoulder-length fall
    hair = (bez((fx - 84, head_cy), (fx - 118, 236), (fx - 60, 202), (fx + 60, 202), 30)
            + bez((fx + 60, 202), (fx + 118, 236), (fx + 118, 236), (fx + 84, head_cy), 24)
            + bez((fx + 84, head_cy), (fx + 116, 384), (fx + 92, 432), (fx + 64, 470), 20)
            + bez((fx + 64, 470), (fx + 26, 486), (fx - 26, 486), (fx - 64, 470), 16)
            + bez((fx - 64, 470), (fx - 92, 432), (fx - 116, 384), (fx - 84, head_cy), 20))
    d.polygon(hair, fill=198)
    # three broad dark locks for shape
    for i in (-1, 0, 1):
        sp = bez((fx + i * 46, 216), (fx + i * 58, 300), (fx + i * 54, 400), (fx + i * 46, 470), 22)
        d.line(sp, fill=112, width=4, joint="curve")
    d.line(hair + [hair[0]], fill=18, width=4, joint="curve")
    # over-ear headset resting on the back of the head
    d.line(bez((fx - 104, head_cy + 10), (fx - 100, head_cy - 104), (fx + 100, head_cy - 104), (fx + 104, head_cy + 10), 26),
           fill=30, width=16, joint="curve")
    for s in (-1, 1):
        hx, hy = fx + s * 104, head_cy + 26
        d.ellipse([hx - 44, hy - 60, hx + 44, hy + 60], fill=24)
        d.ellipse([hx - 44, hy - 60, hx + 44, hy + 60], outline=202, width=4)
        d.ellipse([hx - 26, hy - 38, hx + 26, hy + 38], fill=72)

    # --- acoustic waves travelling from the figure toward the horizon -----
    for k, r in enumerate((150, 210, 274, 342)):
        d.arc([fx + 40, 330 - r * 0.5, fx + 40 + 2 * r, 330 + r * 0.85],
              296, 26, fill=70 + k * 42, width=3)

    # --- code constellations (upper left) --------------------------------
    const = [(110, 96), (206, 72), (300, 118), (268, 196), (168, 178)]
    for i in range(len(const) - 1):
        d.line([const[i], const[i + 1]], fill=150, width=2)
    for (sx, sy) in const:
        d.ellipse([sx - 5, sy - 5, sx + 5, sy + 5], fill=WHITE)
    for (sx, sy, r) in [(400, 128, 12), (760, 96, 16), (960, 140, 10),
                        (620, 74, 10), (860, 62, 9)]:
        spark(d, sx, sy, r, color=240, width=2)


def make_anime_mural():
    # Primary path: a generated panorama reduced to the Bayer purple duotone.
    if plate_from_source("footer-src.png", "footer-anime", size=(1440, 960), pixel_scale=3,
                         gain=1.05, contrast=1.1):
        return
    # Fallback: procedural render (kept so the set always regenerates offline).
    W, H = 1440, 720
    base = Image.new("L", (W, H), 9)
    bd = ImageDraw.Draw(base)
    for y in range(H):
        t = y / H
        bd.line([(0, y), (W, y)], fill=int(8 + 14 * (1 - t)))
    base = radial_glow(base, 940, 452, 660, aspect=0.58, peak=94, blur=76)
    d = ImageDraw.Draw(base)
    draw_anime_mural(d, W, H)
    base = base.filter(ImageFilter.GaussianBlur(radius=0.5))
    save_plate(base, "footer-anime")


# ---------------------------------------------------------------------------
# Editorial / project plates (retained house style)
# ---------------------------------------------------------------------------
def make_mission_header():
    """Panoramic engineering-philosophy banner (1440x640)."""
    w, h = 1440, 640
    img = Image.new("L", (w, h), 8)
    d = ImageDraw.Draw(img)

    horizon_y = 330
    for y in range(horizon_y):
        t = y / horizon_y
        d.line([(0, y), (w, y)], fill=int(12 + 55 * (t ** 1.8)))

    engraving_sphere(d, w // 2, horizon_y - 20, 220, light=(-0.4, -0.7, 0.55))
    starburst(d, w // 2, horizon_y - 20, 230, 480, 72, 95, width=1)

    for y in range(horizon_y, h):
        t = (y - horizon_y) / max(1, (h - horizon_y))
        d.line([(0, y), (w, y)], fill=int(20 + 90 * (t ** 1.4)))
    for i in range(1, 18):
        t = (i / 17.0) ** 1.9
        py = int(horizon_y + t * (h - horizon_y))
        d.line([(0, py), (w, py)], fill=min(240, int(70 + 160 * t)), width=2 if t > 0.5 else 1)
    vp_x, vp_y = w // 2, horizon_y
    for i in range(-24, 25):
        bx = vp_x + i * 115
        d.line([(vp_x, vp_y), (bx, h)], fill=135 if i % 2 == 0 else 75, width=1)

    def monolith(mx, my, mw, mh):
        d.rectangle([mx, my, mx + mw, my + mh], fill=28, outline=215, width=3)
        d.rectangle([mx + 14, my + 14, mx + mw - 14, my + mh - 36], fill=14, outline=160, width=2)
        for k in range(1, 5):
            pad = 14 + k * 16
            d.rectangle([mx + pad, my + pad, mx + mw - pad, my + mh - 36 - pad],
                        outline=80 + k * 35, width=1)
        for led in range(4):
            lx = mx + 22 + led * 22
            ly = my + mh - 20
            d.rectangle([lx, ly, lx + 10, ly + 8], fill=235)

    monolith(130, 210, 250, 290)
    monolith(w - 380, 210, 250, 290)
    monolith(410, 280, 170, 200)
    monolith(w - 580, 280, 170, 200)

    for (sx, sy) in [(220, 110), (480, 80), (960, 85), (1210, 120), (330, 180), (1100, 175)]:
        spark(d, sx, sy, 22, color=245, width=2)

    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    save_plate(img, "mission-header")


def make_editorial_duo(index: int, filename_prefix: str):
    """Paired 840x520 artwork for the three philosophy rows."""
    w, h = 840, 520
    img = Image.new("L", (w, h), 10)
    d = ImageDraw.Draw(img)

    for y in range(0, h, 8):
        d.line([(0, y), (w, y)], fill=18 + int(12 * math.sin(y / 30.0)), width=2)

    if index == 1:
        cx, cy = w // 2, h // 2
        starburst(d, cx, cy, 90, 320, 64, 80, width=1)
        engraving_sphere(d, cx, cy, 135, light=(-0.6, -0.5, 0.6))
        nodes = [(160, 130), (680, 130), (140, 390), (700, 390), (420, 65), (420, 455)]
        for nx, ny in nodes:
            d.line([(cx, cy), (nx, ny)], fill=190, width=3)
            engraving_sphere(d, nx, ny, 38, light=(-0.4, -0.6, 0.7))
            d.ellipse([nx - 46, ny - 46, nx + 46, ny + 46], outline=160, width=1)
    elif index == 2:
        icx, icy = 270, h // 2
        for r in range(190, 20, -12):
            col = 230 if (r // 12) % 2 == 0 else 75
            d.ellipse([icx - r, icy - r, icx + r, icy + r], outline=col, width=3)
        engraving_sphere(d, icx, icy, 65, light=(-0.3, -0.5, 0.8))
        for i in range(28):
            bx = 470 + i * 12
            amp = int(40 + 150 * abs(math.sin(i * 0.35) * math.cos(i * 0.15)))
            d.rectangle([bx, icy - amp, bx + 7, icy + amp], fill=195 if i % 2 == 0 else 120)
            d.rectangle([bx, icy - amp - 14, bx + 7, icy - amp - 6], fill=250)
    else:
        cx, cy = w // 2, h // 2
        for i in range(36):
            ang = (2 * math.pi * i) / 36.0
            rx = cx + math.cos(ang) * 150
            ry = cy + math.sin(ang) * 75
            shade = int(130 + 115 * math.sin(ang))
            d.ellipse([rx - 95, ry - 95, rx + 95, ry + 95], outline=shade, width=2)
        spark(d, 120, 100, 32, color=245, width=2)
        spark(d, w - 120, h - 100, 32, color=245, width=2)

    d.rectangle([16, 16, w - 16, h - 16], outline=110, width=2)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    save_plate(img, filename_prefix)


def make_feature_card_art(index: int, name: str):
    """640x480 artwork for the four project cards (scale 1.22 ready)."""
    w, h = 640, 480
    img = Image.new("L", (w, h), 10)
    d = ImageDraw.Draw(img)
    cx, cy = w // 2, h // 2

    for x in range(0, w, 32):
        d.line([(x, 0), (x, h)], fill=22, width=1)
    for y in range(0, h, 32):
        d.line([(0, y), (w, y)], fill=22, width=1)

    if index == 1:
        # Vyn: autonomous CLI + homelab SSH matrix
        d.rectangle([70, 55, w - 70, h - 55], fill=16, outline=220, width=3)
        d.line([(70, 95), (w - 70, 95)], fill=200, width=2)
        for c in range(3):
            d.ellipse([95 + c * 22, 70, 109 + c * 22, 84], fill=240)
        engraving_sphere(d, cx + 90, cy + 20, 95, light=(-0.5, -0.6, 0.6))
        for row in range(8):
            ly = 125 + row * 34
            lw = 140 + ((row * 67) % 160)
            d.rectangle([105, ly, 120, ly + 14], fill=245)
            d.rectangle([135, ly + 2, 135 + lw, ly + 12], fill=175 if row % 2 == 0 else 115)
    elif index == 3:
        # AppealForge: RAG clinical guideline verification
        for k in range(3):
            ox = 120 + k * 55
            oy = 65 + k * 30
            d.rectangle([ox, oy, ox + 260, oy + 310], fill=24 + k * 18, outline=220, width=3)
            for ln in range(7):
                d.line([(ox + 28, oy + 50 + ln * 34), (ox + 230, oy + 50 + ln * 34)], fill=170, width=4)
        engraving_sphere(d, 445, 305, 82, light=(-0.5, -0.5, 0.7))
        starburst(d, 445, 305, 86, 125, 24, 240, width=2)
    elif index == 4:
        # FoxTube: self-hosted media stream + Nginx proxy
        for r in range(220, 40, -28):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=125 + (220 - r) // 2, width=3)
        d.polygon([(cx - 55, cy - 75), (cx - 55, cy + 75), (cx + 85, cy)], fill=235, outline=40)
        d.polygon([(cx - 35, cy - 45), (cx - 35, cy + 45), (cx + 50, cy)], fill=90)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    save_plate(img, f"feature-{name}")


if __name__ == "__main__":
    make_anime_bust()
    make_anime_mural()
    make_mission_header()
    make_editorial_duo(1, "mission-duo-1")
    make_editorial_duo(2, "mission-duo-2")
    make_editorial_duo(3, "mission-duo-3")
    for idx, slug in [(1, "vyn"), (3, "appealforge"), (4, "foxtube")]:
        make_feature_card_art(idx, slug)
    print("Generated all assets in", OUT_DIR)
