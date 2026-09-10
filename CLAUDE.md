# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A single-page marketing site for Scenic Mountain Roofing, a Utah roofing contractor. Hand-written HTML, CSS and vanilla JS. **No build step, no package manager, no tests, no CI.** What is committed to `main` is what ships.

The whole site is `index.html` — every section lives there, including both JSON-LD blocks and the contact form. There are no other pages.

## Commands

```bash
python3 -m http.server 8000            # serve at http://localhost:8000
lsof -ti:8000 | xargs kill             # stop it
python3 tools/build-logo-assets.py     # regenerate every logo derivative
node --check js/main.js                # syntax check (no linter configured)
```

Browsers cache the CSS aggressively against `http.server`. When a style change appears not to apply, hard-reload or append a query string — don't go hunting for a specificity bug that isn't there.

## Architecture

**Three-layer CSS, load order matters.** `index.html` pulls them in this order and the cascade depends on it:

1. `css/normalize.css` — untouched vendor reset
2. `css/main.css` — the design system. All tokens are custom properties in `:root` at the top (neutrals, `--accent`, `--font-display`/`--font-body`, an 8pt `--sp-*` scale, radii, shadows, `--header-h`, `--ease`). Component rules follow under `/* ── Name ── */` banners.
3. `css/responsive.css` — **overrides only**, at 1150 / 1024 / 860 / 780 / 640 / 560 / 420px, plus a print block

Verify any layout change by *resizing a live page*, not only by loading fresh at each width — a fresh load hides anything that fails to recompute on resize, which is a different class of bug. (A convenient trick: load the page in an off-screen iframe and change the iframe's width without reloading it; media queries and resize handlers fire normally.) Note that Chrome will reuse an already-cached larger `srcset` candidate rather than downgrading, so `currentSrc` after a resize is not evidence of what a cold load fetches — cache-bust the image URLs to measure that.

Use the tokens rather than literal colors or px spacing. New component rules go in `main.css` under a matching banner; their breakpoint overrides go in `responsive.css`. Because `responsive.css` loads last, a desktop rule it happens to share a selector with will lose — check both files before concluding a rule is dead.

### The layout is full-bleed, not a fixed box

`.container` has no design max-width — only a `2200px` sanity stop for ultrawide. The page spans the viewport and the only inset is `--gutter`, a `clamp(1.25rem, 2.5vw, 3rem)` that scales 20px on a phone to 48px on a large display (and up to 80px past 1600px). Every row therefore shares one inset, which is what makes the width read as deliberate. Do not reintroduce a fixed content width.

Because lines would otherwise run the full screen, **readability is capped per element, not by the container**: `--measure` / `--measure-wide` on prose, `.section-head` at 760px, `.faq` at 900px, `.spec-list` at 40rem, and `.contact`'s form track at `minmax(0, 660px)`. When you add a text block to a wide row, give it a measure.

Two helpers exist for going past the gutter: `.bleed` cancels it outright, and `.bleed-mobile` does so only below 640px — that is what makes the Color Studio a full-width band on phones (`border-radius` and side borders are dropped there too). `.split` is the editorial two-column pattern (heading left, prose right) used by the About section.

**Visual elements scale with the viewport; they do not sit at fixed pixel widths.** The frames (cards, panels, the studio) always reflowed, but their *contents* used to be pinned — the hero logo at 560px, the material mark at 340px, the footer logo at 190px — so a growing frame wrapped a static image. They are now `clamp()`/percentage based:

- `.hero-logo` — `clamp(16rem, 68vw, 48rem)`, one continuous curve from 320px up. Keep it continuous: a separate `88%` mobile rule used to make the logo *grow as the window shrank* across the 640px boundary. The 48rem cap is an LCP trade — this artwork is detailed line art that neither lossy nor lossless compression shrinks much (1120w ≈ 158KB either way), so the cap keeps desktop on the 840w/98KB candidate.
- `.material-visual picture` — the width belongs on the `<picture>`, not the inner `<img>`. `.material-visual` is `display: grid; place-items: center`, so the picture is a shrink-to-fit grid item; a percentage on the `<img>` resolves against the picture's own box rather than the grid area and silently caps the mark far below what you asked for.
- `sizes` uses a media-condition list (`(min-width: 1130px) 768px, 68vw`), not `min()`/`clamp()`. Support for CSS math functions inside `sizes` is not universal, and an unparseable value falls back to `100vw`, which over-downloads.

**Every grid track is `minmax(0, 1fr)`, never `1fr`.** A bare `1fr` is `minmax(auto, 1fr)`, so its `auto` floor lets a wide unbreakable child — `tayton@scenicmtnroofing.com` is the real culprit here — push the track past the viewport and give the whole page a horizontal scrollbar. That bug appeared at 320px in exactly this way. Long addresses also carry `overflow-wrap: anywhere`. Verify any layout change by sweeping widths for `documentElement.scrollWidth > innerWidth`, not by eyeballing one viewport.

**Two scripts, both deferred, no dependencies, no load-order coupling.**

- `js/main.js` — sticky-header state, mobile nav, scroll-spy, FAQ accordion, reveal-on-scroll, sticky action bar, form validation, and the `?sent=true` success banner. Each concern is its own `initX()` behind a single `init()`.
- `js/color-studio.js` — swatch selection, the live summary row, `localStorage` persistence under `smr.colors.v1`, and writing the chosen color names into the form's hidden `data-choice` inputs so they ride along with the estimate request.

### The header has three modes, and none of them hide a menu item

| Width | Header | Nav |
| --- | --- | --- |
| ≥1151px | one row, 68px | all 8 links inline, right-anchored |
| 641–1150px | **two rows**, ~116–127px | brand + phone + CTA on row 1; all 8 links right-anchored on row 2 |
| ≤640px | one row, 62px | right-anchored drawer, full height to the bottom edge |

Nothing is dropped as the window narrows — the header reflows instead. Three things make this work and are easy to break:

- **`.nav-link` needs `white-space: nowrap`.** Without it the flex items shrink and wrap their own labels, so "What's Included" and "Why Us" become two lines and sit misaligned against the other six. That wrapping also *hides* the real breakpoint: it lets the row appear to fit at widths where it does not, which is how an earlier 1080px boundary got measured wrong. The single row genuinely overflows below ~1140px, hence 1150.
- **In the two-row band, `.nav-inner` is what fills the width** (`width: 100%; justify-content: flex-end`), not `.nav-list`. `.nav-list` is a shrink-to-fit flex item, so `justify-content` on it does nothing — set it on the row that has the free space, or the nav silently sits left while the CTA sits right.
- **Two runtime measurements exist because CSS cannot express them**: `initHeaderMetrics()` publishes `--header-real` and `initActionBar()` publishes `--actionbar-h` (which ranges 79–124px as its label wraps). Both re-measure on resize. If you add anything whose size CSS can't derive, follow that pattern rather than hardcoding a value.
- **The header height is measured, not declared.** `initHeaderMetrics()` publishes `--header-real`, and `scroll-padding-top` plus the drawer's top inset both read it. The two-row header is 116–127px depending on link padding, so a hardcoded `--header-h` leaves anchor targets buried under the sticky header. `--header-h` remains only as the fallback.

In the drawer, `.nav-cta` uses `margin-top: auto` to pin the two CTAs to the bottom edge, and `.brand, .nav-toggle, .header-cta` get `z-index: 96`. That last one matters: `.nav` is a *child* of `.header`, so at `z-index: 95` an open drawer paints over the header's own controls and the toggle vanishes, leaving no visible way to close the menu. Lifting them above it also means the toggle's existing `[aria-expanded="true"]` X animation becomes the close button.

### Two structural decisions that look odd out of context

**The nav is a viewport-sized clipper.** At ≤860px `.nav` becomes `position: fixed; inset: 0; overflow: hidden; pointer-events: none`, and `.nav-inner` is the panel that actually slides in from the right. This exists because an off-canvas panel translated past the right edge extends the document's scrollable width and gives the whole page a horizontal scrollbar — and neither `overflow-x: hidden`/`clip` on `body` nor on `html` contains a `position: fixed` child. `.nav` staying pointer-transparent at every state is what lets clicks in the empty area fall through to `.nav-scrim` beneath it, which is what closes the panel. Don't collapse `.nav-inner` back into `.nav`.

**Reveal animations are gated on a `js` class.** An inline script in `<head>` sets `document.documentElement.classList.add('js')`, and only `.js .reveal` gets `opacity: 0`. Without that gate a blocked or failed script leaves most of the page blank. Any new scroll-revealed element needs the `reveal` class and nothing else.

Related trap: `.form-banner` sets `display: flex`, which beats the UA stylesheet's `[hidden] { display: none }`. `.form-banner[hidden]` restores it explicitly. Any new component styled with an explicit `display` and toggled via the `hidden` attribute needs the same guard.

## Content that must stay in sync

- Both `application/ld+json` blocks are in `index.html`: a `RoofingContractor` block (contact details, `areaServed`, `hasOfferCatalog` of services) and an `FAQPage` block. **Google requires the FAQ markup to match the visible accordion text exactly** — edit a question or answer and you must edit it in both places.
- Section `id`s are load-bearing three times over: the nav links, the footer links, and `initScrollSpy()`/`initActionBar()` in `js/main.js` all key off them. Renaming one silently breaks scroll-spy.
- Contact details (phone `801-473-7448`, email) appear in the header, the estimate section, the footer, the form's `action`, and the JSON-LD. Grep before editing.
- `sitemap.xml`, `robots.txt`, the canonical tag, the OG/Twitter URLs and the form's `_next` all hardcode the production host.

## Image assets

Two pipelines, and they are deliberately different because the content is different:

- **Logos** (`images/logo/`, built by `tools/build-logo-assets.py`) — line art, so **WebP + PNG** with transparency.
- **Photographs** (`images/roofs/`, built by `tools/build-photo-assets.py`) — **WebP + JPEG**. PNG roughly triples the bytes on photographic content, and photos carry no useful transparency. Sources are `*-source.*`, discovered by glob and never served; the width ladder is capped by the source's own resolution rather than upscaling.

The Materials panel (`.material-visual`) holds a photograph, so it has no padding and the image fills the frame at its natural aspect ratio — no `object-fit` cropping. Two things there are easy to get wrong: `.material` uses `align-items: start`, because the photo is much shorter than the spec list and centering leaves it floating in dead space; and `.badge-float` is *dark* glass, because it sits over bright sky rather than over the dark panel it was originally designed against.

## Logo assets

Everything under `images/logo/` is generated from `images/logo/smr-logo-source.png` by `tools/build-logo-assets.py`. The source art is black-on-white with no alpha; the script derives alpha from luminance (so edges stay antialiased), recolors for light and dark backgrounds, auto-detects the blank band between the mountain and the wordmark to crop the square mark, then emits the favicons and the 1200×630 OG card. Edit the script and re-run it rather than hand-editing any derivative.

## Known outstanding items

- The FormSubmit endpoint (`tayton@scenicmtnroofing.com`) needs its one-time email activation before submissions deliver.
- The `5.0 ★` Google rating in the stats block is hardcoded in `index.html`. Check it against the live Google Business listing whenever the stats are touched, since nothing keeps it in sync automatically.

## Facts about the business

Worth knowing, because several of these are asserted on the page and are not derivable from the code:

- Established **2026** — the company is new. Do not add tenure, volume, or "trusted by thousands"-style claims.
- Domain **scenicmtnroofing.com**; domain and email are managed in **Google Workspace** (so DNS carries MX records — never propose DNS changes that would disturb them).
- Contact: `tayton@scenicmtnroofing.com`, 801-473-7448.
- Service area: Utah County, Salt Lake County, Wasatch/Heber Valley, Ogden, Cache Valley, St. George.
