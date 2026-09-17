#!/usr/bin/env python3
"""
Regenerate the Color Studio's shingle swatch chips from images/shingles/*-source.webp.

Same reasoning as the roof photos: WebP + JPEG, never PNG, because these are
photographs of granulated asphalt and PNG roughly triples the bytes.

Two things are specific to these:

* Every chip is centre-cropped to CHIP_ASPECT before resizing. `.swatch-chip` is
  a fixed 4/3 box and the sources are not one aspect ratio — Dynasty swatches
  arrive near-square and Armourshake near 1.9:1 — so letting each keep its own
  shape would make the grid ragged. Cropping a repeating shingle texture costs
  nothing; it is the same courses either way.
* The average colour of each crop is printed. `index.html` carries it on the
  swatch as `data-tone`, which paints the chip before its image loads and tints
  the summary dot. Re-run this and update those values if the artwork changes.

Requires Pillow:  python3 -m pip install --user Pillow
Run from the repo root:  python3 tools/build-shingle-assets.py
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHINGLE_DIR = ROOT / "images" / "shingles"
WIDTHS = (160, 240, 320, 440)
CHIP_ASPECT = 4 / 3
QUALITY = 80


def crop_to_aspect(img, aspect):
    """Centre-crop to `aspect` (w/h), trimming whichever axis is long."""
    if img.width / img.height > aspect:
        w = round(img.height * aspect)
        left = (img.width - w) // 2
        return img.crop((left, 0, left + w, img.height))
    h = round(img.width / aspect)
    top = (img.height - h) // 2
    return img.crop((0, top, img.width, top + h))


def average_hex(img):
    r, g, b = img.resize((1, 1), Image.LANCZOS).getpixel((0, 0))
    return f"#{r:02x}{g:02x}{b:02x}"


def main():
    sources = sorted(SHINGLE_DIR.glob("*-source.webp"))
    if not sources:
        print("no *-source.webp files in", SHINGLE_DIR)
        print("run tools/fetch-shingle-sources.py first")
        return

    for src in sources:
        stem = src.name.split("-source")[0]
        img = crop_to_aspect(Image.open(src).convert("RGB"), CHIP_ASPECT)

        widths = sorted({w for w in WIDTHS if w < img.width} | {min(img.width, max(WIDTHS))})
        total = 0
        for w in widths:
            h = round(w / CHIP_ASPECT)
            out = img.resize((w, h), Image.LANCZOS)
            out.save(SHINGLE_DIR / f"{stem}-{w}.webp", quality=QUALITY, method=6)
            out.save(SHINGLE_DIR / f"{stem}-{w}.jpg", quality=QUALITY, optimize=True, progressive=True)
            total += (SHINGLE_DIR / f"{stem}-{w}.webp").stat().st_size
            total += (SHINGLE_DIR / f"{stem}-{w}.jpg").stat().st_size

        print(f"{stem:34s} tone {average_hex(img)}   {len(widths)} widths   {total / 1024:5.0f}KB")


if __name__ == "__main__":
    main()
