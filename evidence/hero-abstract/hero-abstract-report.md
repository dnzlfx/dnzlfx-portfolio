# Hero PR B — Hero abstracto original y assets aislados

## Qué cambia

| Archivo | Cambio |
| --- | --- |
| `index.html` (sección Hero, líneas ~57–108) | Sustituye las placas `hero-anime-*` por `hero-abstract-*`; `alt` y `aria-label` reescritos a la descripción abstracta. Resto del hero (título, lead, status, CTAs) intacto. |
| `assets/hero-abstract-mono.png` (nuevo, 1024×1536) | Composición abstracta celestial en duotono plata (paleta `PAL_MONO`). |
| `assets/hero-abstract-color.png` (nuevo, 1024×1536) | Misma composición en duotono morado eléctrico (`PAL_COLOR`) para el revelado hover/focus. |
| `assets/hero-anime-{mono,color}.png` (eliminados) | Chico anime con audífonos (identidad no deseada). |
| `assets/hero-totem-{mono,color}.png` (eliminados) | Variante huérfana del mismo personaje (no referenciada). |
| `assets/raw/hero-src.png` (eliminado) | Fuente del personaje anime del hero. |
| `test_scroll_math.mjs` | Check obsoleto actualizado (autorizado por alcance #«actualizar checks obsoletos sin falsear pruebas»): la aserción de `hero-anime-*` pasa a `hero-abstract-*` y `dir` se resuelve desde `import.meta.url` para que el check valide su propio checkout. |

No se tocó nav, proyectos, footer, motion, reglas globales ni `generate_assets.py`.

## Arte original

- Composición original generada con `hermes-generate-image` (endpoint privado), prompt puramente abstracto y sin personas/rostros/personajes: núcleo celestial luminoso, anillos orbitales concéntricos, retícula de datos en perspectiva, paneles flotantes y haces radiales.
- Post-proceso con PIL en la misma paleta y dither Bayer 8×8 ordenado del repo (`generate_assets.py`, reutilizado en solo lectura): recorte del margen/franja de papel, encuadre 2:3, black-floor para que el campo resuelva al `#07060B` de la página, y **falloff radial elíptico** (normalizado por eje, sin numpy) para disolver los cuatro bordes en el fondo.

## Verificación real (Chromium vía Playwright)

Harness: servidor estático sobre el worktree + navegador real (`hero_verify.cjs`). Resultado `HERO VERIFY: PASS` — 12/12 criterios:

- 0 errores de consola, 0 `pageerror`, 0 peticiones fallidas (ningún 404 por los assets eliminados).
- Las dos placas cargan (`naturalWidth 1024`, `naturalHeight 1536`) y sus `src` son `hero-abstract-{mono,color}.png`.
- Cero assets `hero-anime`/`hero-totem` presentes en la página.
- Capa plata (mono) renderiza con la capa morada en `opacity: 0`.
- Revelado duotono: `opacity 1` con hover, vuelve a `0` al salir el puntero, y `opacity 1` con foco de teclado (`document.activeElement.className === "dx-hero-plate"`) — el `tabindex="0"` mantiene el camino accesible.
- Sin overflow horizontal ni recortes de la placa en 1440, 1024, 768, 390, 360 y 320 px.
- `node test_scroll_math.mjs` → `PASS: All 10 assertion suites (25 image bindings verified) succeeded.`

Estado de reposo: la placa del hero está cerca del centro del viewport al cargar, así que el mecanismo `isNearViewportCenter()` de `app.js` ya marca `data-color-active` — igual que el resto de placas `.nw-mission-*`. El revelado morado es por tanto el estado natural del hero; la capa plata se documenta forzando el estado sin revelado.

Distribución de píxeles de la placa color: 70.4 % fondo de página + 17.4 % nivel-1 (frente a 39.1 % nivel-1 del hero anime baseline) → la placa se funde más que antes, en la misma familia que las placas `mission-*` (72.9 % fondo).

Revisión visual con `vision_analyze`: composición abstracta confirmada, **sin personaje ni rostro**, texto y CTAs legibles, 7/10. Observación honesta: el borde del panel se percibe en inspección cercana (la placa se lee como panel contenido, no como degradado totalmente disuelto); es coherente con el lenguaje de placas del resto del sitio (`mission-*`, footer mural) y ya es bastante más disuelto que la placa anime anterior. No se añadió máscara CSS extra porque el encuadre tipo placa es la convención del sistema.

Capturas: `hero-desktop-initial.png` (reposo, duotono morado), `hero-desktop-mono.png` (capa plata), `hero-desktop-color.png` (reveal hover), `hero-desktop-focus.png` (reveal teclado), `hero-mobile.png`. Informe: `hero-verification-report.json`.
