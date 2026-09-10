#!/usr/bin/env python3
"""
Regenerate responsive variants for the photographs in images/roofs/.

Photos get WebP + JPEG (not PNG, which roughly triples the bytes on
photographic content). Source files are `*-source.png|jpg` and are never
upscaled — a variant wider than the source is skipped, so the ladder is
naturally capped by whatever resolution the original actually has.

Requires Pillow:  python3 -m pip install --user Pillow
Run from the repo root:  python3 tools/build-photo-assets.py
"""

import pathlib
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PHOTO_DIR = ROOT / "images" / "roofs"
WIDTHS = (480, 640, 800, 1120, 1600)
QUALITY = 82


def main():
    sources = sorted(PHOTO_DIR.glob("*-source.*"))
    if not sources:
        print("no *-source.* files in", PHOTO_DIR)
        return

    for src in sources:
        stem = src.name.split("-source")[0]
        img = Image.open(src)
        # Photos carry no meaningful transparency; flatten so JPEG can be written.
        if img.mode in ("RGBA", "LA", "P"):
            img = img.convert("RGBA")
            flat = Image.new("RGB", img.size, (255, 255, 255))
            flat.paste(img, mask=img.split()[-1])
            img = flat
        else:
            img = img.convert("RGB")

        print(f"{src.name}  source {img.width}x{img.height}")
        # Always include the source's own width so the top of the ladder is the
        # best the original actually offers, whatever that happens to be.
        widths = sorted({w for w in WIDTHS if w < img.width} | {img.width})
        for w in widths:
            h = round(w * img.height / img.width)
            out = img.resize((w, h), Image.LANCZOS)
            out.save(PHOTO_DIR / f"{stem}-{w}.webp", quality=QUALITY, method=6)
            out.save(PHOTO_DIR / f"{stem}-{w}.jpg", quality=QUALITY, optimize=True, progressive=True)
            wk = (PHOTO_DIR / f"{stem}-{w}.webp").stat().st_size / 1024
            jk = (PHOTO_DIR / f"{stem}-{w}.jpg").stat().st_size / 1024
            print(f"  {w}x{h}   webp {wk:.0f}KB   jpg {jk:.0f}KB")


if __name__ == "__main__":
    main()
