# dnzlfx — Portfolio Demo

Personal software engineering portfolio prototype for **Christian Denzel (`dnzlfx`)**, built with zero-dependency vanilla HTML, CSS, and JavaScript.

> **Disclaimer:** This project is an independent personal portfolio demo inspired by the dark/violet editorial aesthetic of Nous Research. It is **not** affiliated with, endorsed by, or connected to Nous Research, and it uses **no** Nous Research trademarks, logos, or proprietary assets. All artwork in `assets/` is procedurally generated in-repo (`generate_assets.py`).

## Features

- **Zero runtime dependencies:** Pure `index.html`, `styles.css`, and `app.js` — runs directly on any static file server.
- **Lenis-style damped wheel & parallax scroll:** Smooth `requestAnimationFrame` damping (`--py-hero`, `--nw-mission-shift`, `--py`, `--py-img`) with monochrome-to-color scroll reveal plates.
- **Accessibility & Reduced Motion:** Full `prefers-reduced-motion` support (plus an interactive UI toggle), keyboard focus rings, and WCAG AA contrast compliance (`>= 6.0:1`).
- **Procedural Duotone Artwork:** Reproducible SVG/PNG asset generator (`generate_assets.py`) producing paired monochrome and violet/magenta plates.

## Quick Start

Serve the directory with any static HTTP server:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080` in your browser.

## Verification

Run the scroll-math and binding verification suite:

```bash
node test_scroll_math.mjs
```

Visual screenshots and the continuous smooth-scroll walkthrough recording (`< 25 MB`, self-produced) are available under [`evidence/`](./evidence/).

## License

MIT License — Copyright (c) 2026 Christian Denzel (`dnzlfx`).
