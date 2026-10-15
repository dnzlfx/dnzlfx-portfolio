#!/usr/bin/env python3
"""Generate original dithered artwork in monochrome & purple-duotone for dnzlfx portfolio demo."""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

OUT_DIR = "/mnt/datos/proyectos/dnzlfx-portfolio-demo/assets"
os.makedirs(OUT_DIR, exist_ok=True)

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

def apply_bayer_dither(gray_img: Image.Image, palette_levels, pixel_scale: int = 2) -> Image.Image:
    """Downsample, apply 8x8 Bayer ordered dithering across palette_levels, and nearest-neighbor upscale."""
    w, h = gray_img.size
    sw, sh = max(1, w // pixel_scale), max(1, h // pixel_scale)
    small = gray_img.resize((sw, sh), Image.Resampling.BILINEAR)
    px = small.load()
    out = Image.new("RGB", (sw, sh))
    opx = out.load()
    n_pal = len(palette_levels) - 1
    for y in range(sh):
        row = BAYER_8[y & 7]
        for x in range(sw):
            v = px[x, y] / 255.0
            # Map v to palette segment with Bayer threshold
            scaled = v * n_pal
            idx = int(scaled)
            frac = scaled - idx
            thresh = (row[x & 7] + 0.5) / 64.0
            if frac > thresh and idx < n_pal:
                idx += 1
            opx[x, y] = palette_levels[idx]
    return out.resize((w, h), Image.Resampling.NEAREST)

# Palettes:
# Mono layer (used as base in Nous style with mix-blend-mode: screen or muted dark lavender)
PAL_MONO = [
    (7, 5, 16),       # Deep void black
    (36, 28, 58),     # Dark slate violet
    (96, 82, 138),    # Mid muted lavender
    (182, 168, 220),  # Crisp silver-lavender
    (242, 238, 255),  # Near-white highlight
]

# Purple duotone layer (revealed on hover / center viewport or feature cards)
PAL_COLOR = [
    (8, 4, 20),       # Deep void black
    (59, 7, 100),     # Deep amethyst (#3b0764)
    (126, 34, 206),   # Electric royal purple (#7e22ce)
    (192, 132, 252),  # Vivid lavender (#c084fc)
    (250, 245, 255),  # Starlight white (#faf5ff)
]

def draw_starburst(draw, cx, cy, r_in, r_out, count, color, width=1):
    for i in range(count):
        ang = (2 * math.pi * i) / count
        x1 = cx + math.cos(ang) * r_in
        y1 = cy + math.sin(ang) * r_in
        x2 = cx + math.cos(ang) * r_out
        y2 = cy + math.sin(ang) * r_out
        draw.line([(x1, y1), (x2, y2)], fill=color, width=width)

def draw_engraving_sphere(draw, cx, cy, radius, light_dir=(-0.5, -0.6, 0.6)):
    """Draw shaded sphere using classical engraving contour rings."""
    lx, ly, lz = light_dir
    norm = math.sqrt(lx*lx + ly*ly + lz*lz)
    lx, ly, lz = lx/norm, ly/norm, lz/norm
    for r in range(radius, 0, -2):
        # Latitude/longitude shading approximation
        for a in range(0, 360, 3):
            rad = math.radians(a)
            nx = (r / radius) * math.cos(rad)
            ny = (r / radius) * math.sin(rad)
            nz = math.sqrt(max(0.0, 1.0 - nx*nx - ny*ny))
            dot = max(0.0, nx*lx + ny*ly + nz*lz)
            val = int(35 + 220 * (dot ** 1.35))
            x = cx + nx * radius
            y = cy + ny * radius
            draw.point((x, y), fill=val)

def make_hero_totem():
    w, h = 900, 1100
    img = Image.new("L", (w, h), 10)
    d = ImageDraw.Draw(img)

    cx, cy = w // 2, h // 2 - 30

    # Subtle outer architectural frame & grid
    for step in range(60, w, 60):
        d.line([(step, 40), (step, h - 40)], fill=24, width=1)
    for step in range(60, h, 60):
        d.line([(40, step), (w - 40, step)], fill=24, width=1)

    d.rectangle([45, 45, w - 45, h - 45], outline=90, width=2)
    d.rectangle([58, 58, w - 58, h - 58], outline=48, width=1)

    # Radial sunburst halo (like Hermes hero engraving)
    draw_starburst(d, cx, cy, 170, 390, 96, 115, width=2)
    draw_starburst(d, cx, cy, 230, 430, 48, 175, width=2)

    # Concentric astrolabe rings
    for r, col, w_line in [(380, 140, 2), (340, 85, 1), (295, 200, 3), (245, 120, 1), (195, 220, 2)]:
        d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=col, width=w_line)

    # Central square portal with organic wave interference
    sq = 155
    d.rectangle([cx - sq, cy - sq, cx + sq, cy + sq], fill=18, outline=210, width=3)
    for py in range(cy - sq + 4, cy + sq - 4, 4):
        for px in range(cx - sq + 4, cx + sq - 4, 4):
            dx, dy = (px - cx) / 38.0, (py - cy) / 38.0
            wave = math.sin(dx * dx + dy * dy) + math.cos(dx * 2.2 - dy * 1.7)
            val = int(max(20, min(245, 120 + 65 * wave)))
            d.rectangle([px, py, px + 2, py + 2], fill=val)

    # Classical Stylized Wings (Left and Right symmetrical feathers)
    for side in (-1, 1):
        for i in range(18):
            t = i / 17.0
            angle = math.radians(-35 + t * 85)
            length = 340 - t * 140
            wx0 = cx + side * 110
            wy0 = cy - 60 + t * 180
            wx1 = wx0 + side * math.cos(angle) * length
            wy1 = wy0 + math.sin(angle) * length - (1.0 - t) * 70
            shade = int(245 - t * 130)
            d.line([(wx0, wy0), (wx1, wy1)], fill=shade, width=5)
            # Feather barbs
            for b in range(1, 9):
                bt = b / 9.0
                bx = wx0 + (wx1 - wx0) * bt
                by = wy0 + (wy1 - wy0) * bt
                d.line([(bx, by), (bx + side * 18, by + 26)], fill=max(50, shade - 45), width=2)

    # Central shaded sphere core
    draw_engraving_sphere(d, cx, cy, 105)

    # Bottom network/control reins fanning out (like Hermes 6-arm reins)
    anchors = [(cx - 180, cy + 160), (cx - 90, cy + 190), (cx + 90, cy + 190), (cx + 180, cy + 160)]
    for ax, ay in anchors:
        d.ellipse([ax - 14, ay - 14, ax + 14, ay + 14], fill=230, outline=90, width=2)
        for ray in range(-6, 7):
            tx = ax + ray * 38
            ty = h - 48
            d.line([(ax, ay), (tx, ty)], fill=170 if ray % 2 == 0 else 95, width=2)

    # Corner celestial stars
    for sx, sy in [(120, 130), (w - 120, 130), (120, h - 130), (w - 120, h - 130), (cx, 105)]:
        draw_starburst(d, sx, sy, 0, 28, 8, 240, width=2)
        d.ellipse([sx - 5, sy - 5, sx + 5, sy + 5], fill=255)

    img = img.filter(ImageFilter.GaussianBlur(radius=0.6))
    mono = apply_bayer_dither(img, PAL_MONO, pixel_scale=2)
    color = apply_bayer_dither(img, PAL_COLOR, pixel_scale=2)
    mono.save(os.path.join(OUT_DIR, "hero-totem-mono.png"), optimize=True)
    color.save(os.path.join(OUT_DIR, "hero-totem-color.png"), optimize=True)

def make_mission_header():
    """Panoramic cyber-celestial header (1440x640) inspired by Nous #mission header."""
    w, h = 1440, 640
    img = Image.new("L", (w, h), 8)
    d = ImageDraw.Draw(img)

    # Horizon perspective grid at bottom
    horizon_y = 330
    # Sky nebula gradient + stars
    for y in range(horizon_y):
        t = y / horizon_y
        val = int(12 + 55 * (t ** 1.8))
        d.line([(0, y), (w, y)], fill=val)

    # Giant rising celestial moon/planet with contour shading
    draw_engraving_sphere(d, w // 2, horizon_y - 20, 220, light_dir=(-0.4, -0.7, 0.55))
    draw_starburst(d, w // 2, horizon_y - 20, 230, 480, 72, 95, width=1)

    # Perspective floor grid below horizon
    for y in range(horizon_y, h):
        t = (y - horizon_y) / max(1, (h - horizon_y))
        base = int(20 + 90 * (t ** 1.4))
        d.line([(0, y), (w, y)], fill=base)

    # Horizontal perspective lines
    for i in range(1, 18):
        t = (i / 17.0) ** 1.9
        py = int(horizon_y + t * (h - horizon_y))
        d.line([(0, py), (w, py)], fill=min(240, int(70 + 160 * t)), width=2 if t > 0.5 else 1)

    # Radiating perspective rays from vanishing point
    vp_x, vp_y = w // 2, horizon_y
    for i in range(-24, 25):
        bx = vp_x + i * 115
        d.line([(vp_x, vp_y), (bx, h)], fill=135 if i % 2 == 0 else 75, width=1)

    # Retro CRT terminal monoliths on left and right foreground
    def draw_monolith(mx, my, mw, mh, tilt=1):
        d.rectangle([mx, my, mx + mw, my + mh], fill=28, outline=215, width=3)
        d.rectangle([mx + 14, my + 14, mx + mw - 14, my + mh - 36], fill=14, outline=160, width=2)
        # Nested screen frames
        for k in range(1, 5):
            pad = 14 + k * 16
            d.rectangle([mx + pad, my + pad, mx + mw - pad, my + mh - 36 - pad], outline=80 + k * 35, width=1)
        # Status LEDs
        for led in range(4):
            lx = mx + 22 + led * 22
            ly = my + mh - 20
            d.rectangle([lx, ly, lx + 10, ly + 8], fill=235)

    draw_monolith(130, 210, 250, 290)
    draw_monolith(w - 380, 210, 250, 290)
    draw_monolith(410, 280, 170, 200)
    draw_monolith(w - 580, 280, 170, 200)

    # Four-pointed celestial sparkles in sky
    sparkles = [(220, 110), (480, 80), (960, 85), (1210, 120), (330, 180), (1100, 175)]
    for sx, sy in sparkles:
        draw_starburst(d, sx, sy, 0, 24, 4, 250, width=2)
        d.ellipse([sx - 4, sy - 4, sx + 4, sy + 4], fill=255)

    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    mono = apply_bayer_dither(img, PAL_MONO, pixel_scale=2)
    color = apply_bayer_dither(img, PAL_COLOR, pixel_scale=2)
    mono.save(os.path.join(OUT_DIR, "mission-header-mono.png"), optimize=True)
    color.save(os.path.join(OUT_DIR, "mission-header-color.png"), optimize=True)

def make_editorial_duo(index: int, filename_prefix: str):
    """Create 840x520 paired monochrome + purple duotone artwork for the 3 Nous-style rows."""
    w, h = 840, 520
    img = Image.new("L", (w, h), 10)
    d = ImageDraw.Draw(img)

    # Background subtle interference
    for y in range(0, h, 8):
        d.line([(0, y), (w, y)], fill=18 + int(12 * math.sin(y / 30.0)), width=2)

    if index == 1:
        # Row 1: Local-First Neural Core & Linux Nodes
        cx, cy = w // 2, h // 2
        draw_starburst(d, cx, cy, 90, 320, 64, 80, width=1)
        draw_engraving_sphere(d, cx, cy, 135, light_dir=(-0.6, -0.5, 0.6))
        # Orbiting nodes
        nodes = [(160, 130), (680, 130), (140, 390), (700, 390), (420, 65), (420, 455)]
        for nx, ny in nodes:
            d.line([(cx, cy), (nx, ny)], fill=190, width=3)
            draw_engraving_sphere(d, nx, ny, 38, light_dir=(-0.4, -0.6, 0.7))
            d.ellipse([nx - 46, ny - 46, nx + 46, ny + 46], outline=160, width=1)
    elif index == 2:
        # Row 2: Multimodal Vision, Voice & Telemetry Waveforms
        # Concentric optical iris on left + frequency spectrogram on right
        icx, icy = 270, h // 2
        for r in range(190, 20, -12):
            col = 230 if (r // 12) % 2 == 0 else 75
            d.ellipse([icx - r, icy - r, icx + r, icy + r], outline=col, width=3)
        draw_engraving_sphere(d, icx, icy, 65, light_dir=(-0.3, -0.5, 0.8))
        # Waveform bars on right
        for i in range(28):
            bx = 470 + i * 12
            amp = int(40 + 150 * abs(math.sin(i * 0.35) * math.cos(i * 0.15)))
            d.rectangle([bx, icy - amp, bx + 7, icy + amp], fill=195 if i % 2 == 0 else 120)
            d.rectangle([bx, icy - amp - 14, bx + 7, icy - amp - 6], fill=250)
    else:
        # Row 3: Zero-Hijack Scroll Mechanics & Torus Geometry
        cx, cy = w // 2, h // 2
        for i in range(36):
            ang = (2 * math.pi * i) / 36.0
            rx = cx + math.cos(ang) * 150
            ry = cy + math.sin(ang) * 75
            shade = int(130 + 115 * math.sin(ang))
            d.ellipse([rx - 95, ry - 95, rx + 95, ry + 95], outline=shade, width=2)
        draw_starburst(d, 120, 100, 0, 35, 8, 245, width=2)
        draw_starburst(d, w - 120, h - 100, 0, 35, 8, 245, width=2)

    d.rectangle([16, 16, w - 16, h - 16], outline=110, width=2)
    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    mono = apply_bayer_dither(img, PAL_MONO, pixel_scale=2)
    color = apply_bayer_dither(img, PAL_COLOR, pixel_scale=2)
    mono.save(os.path.join(OUT_DIR, f"{filename_prefix}-mono.png"), optimize=True)
    color.save(os.path.join(OUT_DIR, f"{filename_prefix}-color.png"), optimize=True)

def make_feature_card_art(index: int, name: str):
    """Create 640x480 tall dithered artwork for the 6 Hermes-style project cards (scale 1.22 ready)."""
    w, h = 640, 480
    img = Image.new("L", (w, h), 10)
    d = ImageDraw.Draw(img)
    cx, cy = w // 2, h // 2

    # Subtle grid background
    for x in range(0, w, 32):
        d.line([(x, 0), (x, h)], fill=22, width=1)
    for y in range(0, h, 32):
        d.line([(0, y), (w, y)], fill=22, width=1)

    if index == 1:
        # Vyn: Autonomous CLI & Homelab SSH Matrix
        d.rectangle([70, 55, w - 70, h - 55], fill=16, outline=220, width=3)
        d.line([(70, 95), (w - 70, 95)], fill=200, width=2)
        for c in range(3):
            d.ellipse([95 + c * 22, 70, 109 + c * 22, 84], fill=240)
        # Isometric cube / shield in center
        draw_engraving_sphere(d, cx + 90, cy + 20, 95, light_dir=(-0.5, -0.6, 0.6))
        # Terminal prompt lines
        for row in range(8):
            ly = 125 + row * 34
            lw = 140 + ((row * 67) % 160)
            d.rectangle([105, ly, 120, ly + 14], fill=245)
            d.rectangle([135, ly + 2, 135 + lw, ly + 12], fill=175 if row % 2 == 0 else 115)
    elif index == 2:
        # Samantha: Voice & Vision Copilot
        draw_starburst(d, cx, cy, 80, 260, 48, 90, width=2)
        # Stylized eye outline
        for r in range(1, 5):
            d.arc([cx - 220, cy - 130 - r*4, cx + 220, cy + 130 + r*4], 15, 165, fill=220, width=3)
            d.arc([cx - 220, cy - 130 - r*4, cx + 220, cy + 130 + r*4], 195, 345, fill=220, width=3)
        draw_engraving_sphere(d, cx, cy, 78, light_dir=(-0.3, -0.5, 0.8))
        d.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=15, outline=250, width=3)
        d.ellipse([cx - 32, cy - 32, cx - 12, cy - 12], fill=255)
    elif index == 3:
        # AppealForge: RAG Clinical Guideline Verification
        # Layered document planes + verification seal
        for k in range(3):
            ox = 120 + k * 55
            oy = 65 + k * 30
            d.rectangle([ox, oy, ox + 260, oy + 310], fill=24 + k * 18, outline=220, width=3)
            for ln in range(7):
                d.line([(ox + 28, oy + 50 + ln * 34), (ox + 230, oy + 50 + ln * 34)], fill=170, width=4)
        draw_engraving_sphere(d, 445, 305, 82, light_dir=(-0.5, -0.5, 0.7))
        draw_starburst(d, 445, 305, 86, 125, 24, 240, width=2)
    elif index == 4:
        # FoxTube: Self-Hosted Media Stream & Nginx Proxy
        # Play prism + radiating signal waves
        for r in range(220, 40, -28):
            d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=125 + (220 - r) // 2, width=3)
        d.polygon([(cx - 55, cy - 75), (cx - 55, cy + 75), (cx + 85, cy)], fill=235, outline=40)
        d.polygon([(cx - 35, cy - 45), (cx - 35, cy + 45), (cx + 50, cy)], fill=90)
    elif index == 5:
        # Local AI Assistant: Hot Model Switching & Web Context
        # Orbital constellation around central LLM kernel
        draw_engraving_sphere(d, cx, cy, 85, light_dir=(-0.6, -0.5, 0.6))
        for a in range(0, 360, 45):
            rad = math.radians(a)
            ox = cx + math.cos(rad) * 165
            oy = cy + math.sin(rad) * 135
            d.line([(cx, cy), (ox, oy)], fill=170, width=2)
            draw_engraving_sphere(d, int(ox), int(oy), 32, light_dir=(-0.4, -0.6, 0.7))
        d.ellipse([cx - 165, cy - 135, cx + 165, cy + 135], outline=210, width=2)
    else:
        # Physicsmon: Interactive 2D Browser Physics Arena
        # Parabolic trajectories + collision vectors
        for arc_i in range(6):
            pts = []
            for step in range(40):
                t = step / 39.0
                px = 60 + t * (w - 120)
                py = h - 70 - (4 * t * (1 - t)) * (160 + arc_i * 38)
                pts.append((px, py))
            d.line(pts, fill=140 + arc_i * 20, width=3)
        draw_engraving_sphere(d, 190, 220, 62, light_dir=(-0.5, -0.6, 0.6))
        draw_engraving_sphere(d, 450, 190, 52, light_dir=(0.5, -0.6, 0.6))
        draw_starburst(d, cx, 165, 10, 95, 16, 250, width=3)

    img = img.filter(ImageFilter.GaussianBlur(radius=0.5))
    mono = apply_bayer_dither(img, PAL_MONO, pixel_scale=2)
    color = apply_bayer_dither(img, PAL_COLOR, pixel_scale=2)
    mono.save(os.path.join(OUT_DIR, f"feature-{name}-mono.png"), optimize=True)
    color.save(os.path.join(OUT_DIR, f"feature-{name}-color.png"), optimize=True)

if __name__ == "__main__":
    make_hero_totem()
    make_mission_header()
    make_editorial_duo(1, "mission-duo-1")
    make_editorial_duo(2, "mission-duo-2")
    make_editorial_duo(3, "mission-duo-3")
    features = [
        (1, "vyn"),
        (2, "samantha"),
        (3, "appealforge"),
        (4, "foxtube"),
        (5, "local-ai"),
        (6, "physicsmon"),
    ]
    for idx, slug in features:
        make_feature_card_art(idx, slug)
    print("Generated all assets in", OUT_DIR)
