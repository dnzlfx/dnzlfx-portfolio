# Christian Denzel (dnzlfx) — Portfolio

Personal portfolio for **Christian Denzel Guzmán Ramírez** (`dnzlfx`), a 5th-semester
**B.S. in Information Technology Engineering** student at **UPSLP** (Universidad
Politécnica de San Luis Potosí), San Luis Potosí, MX.

Built as a single static page with **native HTML, CSS and JavaScript** — no framework,
no build step, no runtime dependencies.

## What's in it

- **Hero** — editorial headline with a large Bayer-dithered portrait illustration
  that fades into the page background.
- **How I build** — three editorial rows on local-first autonomy, citation-verified
  retrieval, and the balance between architecture and interface.
- **Projects** — one featured card plus two companions, the three projects I want
  people to look at: Vyn & Samantha, AppealForge and FoxTube.
- **About** — bio, languages and frameworks.
- **Contact** — email, GitHub, education.

## Artwork

Every illustration in `assets/` (hero portrait, section plates, project frames,
footer mural) is generated locally by `generate_assets.py`:

1. Source illustration → greyscale (`ImageOps.autocontrast` + tone curve).
2. Fade into the page background `#07060B` **in the greyscale domain**, before
   dithering, so the halftone stays crisp at the edges.
3. Ordered **Bayer 8×8 dither** into a silver monochrome ramp and a purple duotone
   (`#6D28D9` / `#A855F7` / `#C084FC` on `#07060B`), written as `*-mono.png` and
   `*-color.png`.

Requirements: Python 3 with Pillow. `python3 generate_assets.py` regenerates the
whole `assets/` set (the procedural renderer is kept as an offline fallback).

## Scroll engine

`app.js` is a native ES module that reads scroll position and writes CSS custom
properties (`--nw-hero-progress`, `--py-hero`, `--nw-mission-shift`, `--py`,
`--py-img`). It never takes over the scrollbar: wheel momentum is animated onto the
real scroll position, so the native scrollbar, keyboard paging, anchors and touch all
keep working. `prefers-reduced-motion` and the header toggle disable every transform.

## Tests

```bash
node test_scroll_math.mjs
```

Ten assertion suites cover the scroll/parallax math, the frame-rate-independent
damping, and that every asset referenced by `index.html` exists on disk.

## Links

- GitHub: [github.com/dnzlfx](https://github.com/dnzlfx)
- Email: guzmanramirezchristian@outlook.com
