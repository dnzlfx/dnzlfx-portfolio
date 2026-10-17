#!/usr/bin/env python3
"""Procedural generator for the dnzlfx portfolio immersive-footer artwork.

Produces the layered, alpha-integrated mural used by the footer section of
index.html. Every layer is original procedural art (Bayer-dithered, in the
site's black + electric-purple language) drawn with Pillow primitives; no
external asset is copied, sampled or traced.

Integration model: the mural is *not* a rectangular picture. Each layer carries
its own alpha channel, glows out of the page background (--bg / --bg-soft) and
is feathered at every edge, so no layer shows a cropped rectangle boundary.

Outputs (all under assets/, RGBA PNG):
  footer-sky-mono.png     / footer-sky-color.png     starfield + nebula + constellations
  footer-spires-mono.png  / footer-spires-color.png  distant crystalline skyline
  footer-ridge-mono.png   / footer-ridge-color.png   near terrace silhouette + rim glow
  footer-grain.png                                  dithering tile for the CSS gradients

Run:  python3 gen_footer_art.py
"""

from __future__ import annotations

import os
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps

SEED = 20261016
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")

# Bayer 8x8 ordered-dither matrix (values 0..63), tiled into a threshold image.
BAYER8 = (
    (0, 32, 8, 40, 2, 34, 10, 42),
    (48, 16, 56, 24, 50, 18, 58, 26),
    (12, 44, 4, 36, 14, 46, 6, 38),
    (60, 28, 52, 20, 62, 30, 54, 22),
    (3, 35, 11, 43, 1, 33, 9, 41),
    (51, 19, 59, 27, 49, 17, 57, 25),
    (15, 47, 7, 39, 13, 45, 5, 37),
    (63, 31, 55, 23, 61, 29, 53, 21),
)

MONO_BLACK = "#07060B"
MONO_MID = "#8E86A6"
MONO_WHITE = "#F2EDFD"

COLOR_BLACK = "#0A0514"
COLOR_MID = "#6D28D9"
COLOR_WHITE = "#EDE4FD"


def bayer_threshold(size: tuple[int, int]) -> Image.Image:
    """Bayer threshold map (L, 0..255) at 1:1 pixel scale, tiled across `size`.

    The tile must be *tiled*, never resized: stretching the 8x8 matrix to the
    full canvas turns each matrix cell into a ~190 px block and prints a visible
    grid of hard-edged rectangles over the artwork.
    """
    w, h = size
    tile = Image.new("L", (8, 8))
    px = tile.load()
    for y in range(8):
        for x in range(8):
            px[x, y] = int((BAYER8[y][x] + 0.5) / 64.0 * 255.0)
    thr = Image.new("L", (w, h))
    for y in range(0, h, 8):
        for x in range(0, w, 8):
            thr.paste(tile, (x, y))
    return thr


def dither_quantize(field: Image.Image, levels: int = 4) -> Image.Image:
    """Ordered-dither an L field down to `levels` evenly spaced tones."""
    if levels < 2:
        return field.point(lambda v: 255 if v >= 128 else 0)
    step = 255.0 / (levels - 1)
    base = field.point(lambda v: int(v / step) * step)
    frac = ImageChops.subtract(field, base)
    thr = bayer_threshold(field.size)
    mask = ImageChops.subtract(frac, thr, 1.0, 128).point(lambda p: 255 if p >= 128 else 0)
    return ImageChops.add(base, mask.point(lambda p: int(round(step)) if p else 0))


def vgradient(size: tuple[int, int], top: int, bottom: int) -> Image.Image:
    """Vertical linear gradient as an L image."""
    w, h = size
    col = Image.new("L", (1, h))
    px = col.load()
    for y in range(h):
        px[0, y] = int(round(top + (bottom - top) * (y / max(1, h - 1))))
    return col.resize((w, h), Image.Resampling.NEAREST)


def edge_feather(size: tuple[int, int], left: int, right: int, top: int, bottom: int) -> Image.Image:
    """Soft mask: 0 at the given edges, 255 in the core, soft corners."""
    w, h = size
    row = Image.new("L", (w, 1))
    rpx = row.load()
    for x in range(w):
        v = 255
        if left and x < left:
            v = min(v, int(255 * x / left))
        if right and x >= w - right:
            v = min(v, int(255 * (w - 1 - x) / right))
        rpx[x, 0] = v
    hfade = row.resize((w, h), Image.Resampling.NEAREST)

    col = Image.new("L", (1, h))
    cpx = col.load()
    for y in range(h):
        v = 255
        if top and y < top:
            v = min(v, int(255 * y / top))
        if bottom and y >= h - bottom:
            v = min(v, int(255 * (h - 1 - y) / bottom))
        cpx[0, y] = v
    vfade = col.resize((w, h), Image.Resampling.NEAREST)

    return ImageChops.multiply(hfade, vfade)


def duotone(lum: Image.Image, mode: str) -> Image.Image:
    if mode == "mono":
        rgb = ImageOps.colorize(lum, black=MONO_BLACK, mid=MONO_MID, white=MONO_WHITE)
    else:
        rgb = ImageOps.colorize(lum, black=COLOR_BLACK, mid=COLOR_MID, white=COLOR_WHITE)
    return rgb.convert("RGB")


def save_layer(alpha: Image.Image, mode: str, name: str) -> None:
    """Composite: RGB from the dithered luminance, alpha = integration mask."""
    rgb = duotone(alpha, mode)
    out = Image.merge("RGBA", (*rgb.split(), alpha))
    path = os.path.join(OUT_DIR, f"footer-{name}-{mode}.png")
    out.save(path, "PNG", optimize=True)
    print(f"  {os.path.basename(path)}  {out.size[0]}x{out.size[1]}  {os.path.getsize(path) // 1024} KB")


# ---------------------------------------------------------------------------
# Layer 1 — sky: dithered nebula bands, starfield, constellation geometry.
# ---------------------------------------------------------------------------
def build_sky(w: int = 1500, h: int = 1000) -> Image.Image:
    rnd = random.Random(SEED + 11)

    raw = Image.effect_noise((w, h), 26).filter(ImageFilter.GaussianBlur(6))
    grain = ImageOps.autocontrast(raw)
    fine = Image.effect_noise((w, h), 14).filter(ImageFilter.GaussianBlur(1))
    band = vgradient((w, h), 40, 235)

    # Readable cloud masses: heavily blurred ellipses the grain is multiplied
    # into, so the sky shows distinct nebula shapes instead of uniform speckle.
    clouds = Image.new("L", (w, h), 0)
    cdraw = ImageDraw.Draw(clouds)
    for _ in range(11):
        cx = rnd.randint(int(-w * 0.1), int(w * 1.1))
        cy = rnd.randint(int(h * 0.05), int(h * 0.52))
        rw = rnd.randint(int(w * 0.12), int(w * 0.32))
        rh = rnd.randint(int(h * 0.06), int(h * 0.17))
        cdraw.ellipse([cx - rw, cy - rh, cx + rw, cy + rh], fill=rnd.randint(96, 180))
    clouds = clouds.filter(ImageFilter.GaussianBlur(110))

    # Contour-free build-up: autocontrast the grain only, keep the cloud ramp
    # smooth (autocontrasting after compositing prints a hard band edge), and
    # blend a little fine noise back in so the ordered-dither tones never form
    # repeating contour lines.
    field = ImageChops.lighter(
        ImageChops.multiply(grain, band).point(lambda v: int(v * 0.55)),
        ImageChops.multiply(ImageChops.multiply(fine, clouds), band),
    )
    field = Image.blend(field, fine, 0.10).filter(ImageFilter.GaussianBlur(1))

    draw = ImageDraw.Draw(field)

    # Constellation geometry: anchor nodes joined by faint lines.
    anchors = [
        (rnd.randint(int(w * 0.06), int(w * 0.94)), rnd.randint(int(h * 0.05), int(h * 0.44)))
        for _ in range(15)
    ]
    for i in range(0, len(anchors) - 1, 2):
        draw.line([anchors[i], anchors[i + 1]], fill=118, width=1)
    if len(anchors) > 2:
        draw.line([anchors[-1], anchors[0]], fill=70, width=1)
    for (ax, ay) in anchors:
        draw.point((ax, ay), fill=226)

    # Starfield — denser towards the upper half, absent where the skyline sits.
    for _ in range(5200):
        x = rnd.randint(0, w - 1)
        y = rnd.randint(0, int(h * 0.86))
        v = rnd.choice((48, 74, 106, 140, 186, 226))
        field.putpixel((x, y), min(255, field.getpixel((x, y)) + v))

    # Four-point sparkles at the anchor nodes.
    for (ax, ay) in anchors[:8]:
        arm = rnd.choice((5, 7, 9))
        draw.line([(ax - arm, ay), (ax + arm, ay)], fill=245, width=1)
        draw.line([(ax, ay - arm), (ax, ay + arm)], fill=245, width=1)
        draw.point((ax, ay), fill=255)

    glow = field.filter(ImageFilter.GaussianBlur(9))
    sky = ImageChops.lighter(dither_quantize(field, 7), glow.point(lambda v: int(v * 0.5)))
    return ImageChops.multiply(sky, edge_feather((w, h), left=200, right=200, top=110, bottom=210))


# ---------------------------------------------------------------------------
# Layer 2 — spires: distant crystalline skyline glowing out of the dark.
# ---------------------------------------------------------------------------
def build_spires(w: int = 1500, h: int = 560) -> Image.Image:
    rnd = random.Random(SEED + 23)
    field = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(field)
    base_y = h - 24

    x = -40
    while x < w + 40:
        bw = rnd.randint(34, 96)
        tall = rnd.randint(int(h * 0.35), int(h * 0.92))
        lean = rnd.randint(-16, 16)
        top = base_y - tall
        body = [
            (x, base_y),
            (x + bw, base_y),
            (x + bw * 0.72 + lean, top + int(tall * 0.18)),
            (x + bw * 0.5 + lean, top),
            (x + bw * 0.28 + lean, top + int(tall * 0.2)),
        ]
        draw.polygon(body, fill=rnd.choice((52, 68, 84, 104)))
        # Facet highlight + antenna so the towers read as crystal, not blocks.
        draw.line([body[3], body[1]], fill=150, width=1)
        draw.line([(x + bw * 0.5 + lean, top), (x + bw * 0.5 + lean, top - rnd.randint(10, 42))], fill=196, width=1)
        # Horizontal strata: the dithered banding of the site's art language.
        for i in range(1, 7):
            yy = top + int(tall * i / 7)
            draw.line([(x + 3, yy), (x + bw - 3, yy)], fill=max(10, 118 - i * 12), width=1)
        x += bw + rnd.randint(6, 26)

    # A thin veil of high stars above the skyline.
    for _ in range(220):
        field.putpixel((rnd.randint(0, w - 1), rnd.randint(0, 22)), rnd.choice((90, 140, 190)))

    glow = field.filter(ImageFilter.GaussianBlur(6))
    spires = ImageChops.lighter(
        ImageChops.lighter(dither_quantize(field, 4), field.point(lambda v: int(v * 0.9))),
        glow.point(lambda v: int(v * 0.7)),
    )
    # Bottom feather: the skyline sits behind the translucent near terrace, so an
    # unfeathered bottom edge shows through it as a straight horizontal cut.
    return ImageChops.multiply(
        spires, edge_feather((w, h), left=120, right=120, top=0, bottom=int(h * 0.34))
    )


# ---------------------------------------------------------------------------
# Layer 3 — ridge: near terrace silhouette with a glowing rim; opaque where the
# silhouette sits, so it merges into the footer background with no cut edge.
# ---------------------------------------------------------------------------
def build_ridge(w: int = 1500, h: int = 700) -> Image.Image:
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)

    def terrace(
        offset: int, nodes: int, top_min: float, top_max: float, step: int
    ) -> list[tuple[int, int]]:
        """Undulating terrace ridge.

        Heights are smoothed between noise nodes and sampled every few pixels so
        the silhouette keeps varying instead of running flat: a long straight top
        edge reads as an image crop once the layer is scaled up on screen.
        """
        rnd = random.Random(SEED + 37 + step)
        hs = [int(h * rnd.uniform(top_min, top_max)) + offset for _ in range(nodes + 1)]
        pts = [(0, h)]
        samples = nodes * 5
        for i in range(samples + 1):
            f = i * nodes / samples
            i0 = min(int(f), nodes - 1)
            t = f - i0
            s = t * t * (3 - 2 * t)
            y = hs[i0] * (1 - s) + hs[i0 + 1] * s + rnd.uniform(-3.5, 3.5)
            pts.append((int(w * i / samples), int(y)))
        pts.append((w, h))
        return pts

    draw.polygon(terrace(-74, 16, 0.34, 0.56, 1), fill=200)
    draw.polygon(terrace(0, 30, 0.52, 0.72, 2), fill=255)
    # Soften the silhouette: a hard polygon edge survives the upscale and reads as
    # a straight cut across the mural.
    mask = mask.filter(ImageFilter.GaussianBlur(9))

    rim = (
        mask.filter(ImageFilter.FIND_EDGES)
        .filter(ImageFilter.GaussianBlur(2))
        .point(lambda v: min(255, v * 3))
    )
    rim = ImageChops.multiply(rim, vgradient((w, h), 200, 0).point(lambda v: min(255, int(v * 1.6))))
    body = ImageChops.multiply(dither_quantize(mask, 4), mask.point(lambda v: min(150, v)))
    ridge = ImageChops.lighter(
        ImageChops.lighter(body, mask.point(lambda v: 96 if v > 0 else 0)), rim
    )
    # The terrace body is translucent, so its lower band must dissolve into the
    # page background: a hard cut at the layer's bottom edge reads as a seam.
    return ImageChops.multiply(
        ridge, edge_feather((w, h), left=150, right=150, top=0, bottom=int(h * 0.42))
    )


def build_grain(size: int = 160) -> Image.Image:
    """Square RGBA noise tile used as a dithering overlay by the footer CSS.

    Alpha is kept at 0..10 so the repeated speckle only breaks the 8-bit banding
    of the large flat purple gradients instead of being seen as grain.
    """
    rnd = random.Random(SEED + 59)
    tile = Image.new("RGBA", (size, size))
    px = tile.load()
    for y in range(size):
        for x in range(size):
            v = 255 if rnd.random() < 0.5 else 0
            px[x, y] = (v, v, v, rnd.randint(0, 10))
    return tile


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print("footer art ->", OUT_DIR)
    for mode in ("mono", "color"):
        save_layer(build_sky(), mode, "sky")
        save_layer(build_spires(), mode, "spires")
        save_layer(build_ridge(), mode, "ridge")
    grain_path = os.path.join(OUT_DIR, "footer-grain.png")
    build_grain().save(grain_path, "PNG", optimize=True)
    print(f"  footer-grain.png  {os.path.getsize(grain_path) // 1024} KB")


if __name__ == "__main__":
    main()
