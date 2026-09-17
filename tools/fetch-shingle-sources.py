#!/usr/bin/env python3
"""
Re-fetch the IKO swatch photographs that back the Color Studio's shingle grid.

The studio shows the two shingle lines we install — Dynasty(R) and
Armourshake(TM) — using IKO's own product swatch photography, so each chip reads
as asphalt shingle. A flat colour chip reads as a metal panel, which is not what
we sell.

Two things on each product page are parsed, and both matter:

* `<label class="product-colors__item" data-title='Glacier'>` carries the colour
  name and, inside it, `background: url(<swatch photo>)`. That pairing is
  authoritative — name and image sit in the same element, so a re-upload cannot
  shuffle the map. Never re-derive it from document order instead; the page also
  holds installed-roof gallery photos per colour, and ordering those against a
  separate name list is exactly how every chip ends up labelled one colour off.
* `<script type="application/json">{"swatches": ...}` lists every colour with
  the states it is sold in. Colours not sold in Utah are skipped (Dynasty
  Sentinel Slate, as of 2026-09) so the studio cannot offer something we
  can't order.

Sources are downscaled to SOURCE_W on save: the served chips top out at 400px,
so the full ~1400-2000px originals would add ~22MB to the repo for no visible
gain. Raise SOURCE_W and re-run if a larger derivative is ever needed.

Sources are never served. Run `tools/build-shingle-assets.py` afterwards to emit
the served ladder.

Requires Pillow:  python3 -m pip install --user Pillow
Run from the repo root:  python3 tools/fetch-shingle-sources.py
"""

import html
import io
import json
import pathlib
import re
import urllib.request

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "images" / "shingles"
STATE = "UT"
SOURCE_W = 720
UA = {"User-Agent": "Mozilla/5.0 (compatible; scenicmtnroofing-asset-build)"}

PAGES = {
    "dynasty": "https://www.iko.com/na/dynasty/",
    "armourshake": "https://www.iko.com/na/armourshake/",
}


def slug(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def colour_swatches(page_html):
    """{colour name: swatch photo URL}, read off the colour picker's own markup."""
    found = {}
    pattern = r"<label class=\"product-colors__item[^>]*data-title='([^']+)'>(.*?)</label>"
    for match in re.finditer(pattern, page_html, re.S):
        name = html.unescape(match.group(1))
        url = re.search(r"background:\s*url\(([^)]+)\)", match.group(2))
        if url:
            # The picker points at a 252x252 centre crop; the un-resized original
            # is the same file one directory up, and is what we want to build from.
            found[name] = re.sub(r"/resized/(.*)-\d+x\d+-c-\w+(\.\w+)$", r"/\1\2", url.group(1))
    return found


def in_state(page_html):
    """{colour name: sold in STATE}."""
    start = page_html.find('<script type="application/json">{"swatches"')
    start = page_html.find("{", start)
    end = page_html.find("</script>", start)
    blob = json.loads(page_html[start:end])["swatches"]
    return {v["label"]: STATE in v["states"] for v in blob.values()}


def main():
    DEST.mkdir(parents=True, exist_ok=True)

    for line, page in PAGES.items():
        page_html = fetch(page).decode("utf-8", "replace")
        swatches = colour_swatches(page_html)
        states = in_state(page_html)
        if not swatches:
            raise SystemExit(f"{line}: no colour swatches found — IKO changed the page markup")

        print(f"{line}: {len(swatches)} colours on the page")
        for name, url in swatches.items():
            if not states.get(name, True):
                print(f"  skip  {name}  (not sold in {STATE})")
                continue
            img = Image.open(io.BytesIO(fetch(url))).convert("RGB")
            if img.width > SOURCE_W:
                img = img.resize((SOURCE_W, round(SOURCE_W * img.height / img.width)), Image.LANCZOS)
            out = DEST / f"{line}-{slug(name)}-source.webp"
            img.save(out, quality=88, method=6)
            kb = out.stat().st_size / 1024
            print(f"  {out.name:44s} {img.width}x{img.height}  {kb:6.1f}KB")


if __name__ == "__main__":
    main()
