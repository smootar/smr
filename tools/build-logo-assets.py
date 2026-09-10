#!/usr/bin/env python3
"""
Regenerate every logo derivative from images/logo/smr-logo-source.png.

The source art is black-on-white with no alpha. We derive alpha from luminance so
the edges stay antialiased, then recolor for light and dark backgrounds.

Requires Pillow:  python3 -m pip install --user Pillow
Run from the repo root:  python3 tools/build-logo-assets.py
"""

import pathlib
import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
LOGO_DIR = ROOT / "images" / "logo"
SOURCE = LOGO_DIR / "smr-logo-source.png"

DARK = (13, 17, 23)      # --ink
WHITE = (255, 255, 255)


def build(rgb, alpha):
    out = np.zeros((alpha.shape[0], alpha.shape[1], 4), dtype=np.uint8)
    out[..., 0], out[..., 1], out[..., 2] = rgb
    out[..., 3] = alpha
    return Image.fromarray(out, "RGBA")


def save(img, name, width, quality=92):
    resized = img.resize((width, round(width * img.height / img.width)), Image.LANCZOS)
    resized.save(LOGO_DIR / f"{name}.png", optimize=True)
    resized.save(LOGO_DIR / f"{name}.webp", quality=quality, method=6)
    kb = (LOGO_DIR / f"{name}.webp").stat().st_size / 1024
    print(f"  {name}  {resized.width}x{resized.height}  q{quality}  {kb:.0f}KB")


def main():
    grey = np.array(Image.open(SOURCE).convert("L")).astype(np.float32)

    # Trim the white margin
    ink = grey < 240
    ys, xs = np.where(ink)
    grey = grey[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    ink = ink[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
    height = grey.shape[0]

    alpha = (255.0 - grey).clip(0, 255).astype(np.uint8)

    print("full lockup:")
    save(build(DARK, alpha), "smr-logo", 1200)
    save(build(WHITE, alpha), "smr-logo-white", 1200)
    save(build(DARK, alpha), "smr-logo-sm", 480)
    save(build(WHITE, alpha), "smr-logo-white-sm", 480)

    # Hero lockup: the LCP image. It now scales with the viewport (62vw, capped
    # at 880px CSS), so the ladder has to reach 2x of that cap.
    print("hero srcset:")
    for w in (560, 840, 1120, 1400, 1760):
        # This is the LCP image. It is flat two-tone line art, which tolerates a
        # lower quality at large sizes without visible artefacting — and the big
        # candidates are exactly the ones worth trimming.
        save(build(WHITE, alpha), f"smr-logo-white-{w}", w, quality=92 if w <= 840 else 78)

    # Header brand mark: rendered in a ~68px box, so 1x/2x/3x only.
    print("header srcset:")
    for w in (136, 204):
        save(build(DARK, alpha), f"smr-logo-xs-{w}", w)

    # Isolate the mountain mark: the widest blank band splits it from the wordmark
    rows = ink.sum(axis=1)
    gaps, i = [], 0
    while i < len(rows):
        if rows[i] == 0:
            j = i
            while j < len(rows) and rows[j] == 0:
                j += 1
            gaps.append((i, j - i))
            i = j
        else:
            i += 1
    candidates = [g for g in gaps if height * 0.3 < g[0] < height * 0.85]
    split = max(candidates, key=lambda g: g[1])[0] if candidates else int(height * 0.62)

    mark = alpha[:split, :]
    cols = np.where((mark > 15).any(axis=0))[0]
    mark = mark[:, cols.min():cols.max() + 1]

    print("mountain mark:")
    for name, rgb in (("mark", DARK), ("mark-white", WHITE)):
        img = build(rgb, mark)
        side = max(img.width, img.height)
        pad = int(side * 0.06)
        canvas = Image.new("RGBA", (side + pad * 2, side + pad * 2), (0, 0, 0, 0))
        canvas.paste(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2), img)
        # 512 only: mark-512 is the favicon source and mark-white-512 is kept as a
        # small brand asset. The 680/1024 sizes existed to fill the materials
        # panel, which now holds a photograph instead.
        for side_px in (512,):
            out = canvas.resize((side_px, side_px), Image.LANCZOS)
            out.save(LOGO_DIR / f"{name}-{side_px}.png", optimize=True)
            out.save(LOGO_DIR / f"{name}-{side_px}.webp", quality=92, method=6)
            print(f"  {name}-{side_px}  {side_px}x{side_px}")

    print("favicons:")
    square = Image.open(LOGO_DIR / "mark-512.png")
    for size in (16, 32, 180):
        square.resize((size, size), Image.LANCZOS).save(LOGO_DIR / f"favicon-{size}.png", optimize=True)
        print(f"  favicon-{size}.png")
    square.resize((64, 64), Image.LANCZOS).save(
        LOGO_DIR / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)]
    )
    print("  favicon.ico")

    # Social share card: white lockup on the hero gradient
    print("og-image:")
    w, h = 1200, 630
    top, bottom = np.array([16, 22, 33], np.float32), np.array([8, 11, 17], np.float32)
    ramp = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    bg = (top * (1 - ramp) + bottom * ramp).astype(np.uint8)
    card = Image.fromarray(np.repeat(bg, w, axis=1), "RGB").convert("RGBA")

    lockup = Image.open(LOGO_DIR / "smr-logo-white.png")
    lockup = lockup.resize((760, round(760 * lockup.height / lockup.width)), Image.LANCZOS)
    card.alpha_composite(lockup, ((w - lockup.width) // 2, (h - lockup.height) // 2 - 10))
    card.convert("RGB").save(ROOT / "images" / "og-image.png", optimize=True)
    print("  images/og-image.png  1200x630")


if __name__ == "__main__":
    main()
