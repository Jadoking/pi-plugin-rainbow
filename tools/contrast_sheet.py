#!/usr/bin/env python3
"""Before/after sheet for the contrast floor."""
import subprocess
import sys
import pathlib
from PIL import Image, ImageDraw, ImageFont

PY = sys.executable
ROOT = pathlib.Path(__file__).parent
PAIRS = [("inferno", "15.0% unreadable"), ("aquarium", "16.7% unreadable")]

tiles = []
for b, bad in PAIRS:
    for tag, prefix, note in (("before", "f", bad), ("after", "g", "0% unreadable")):
        src = f"/tmp/pilive/{prefix}-{b}.ans"
        png = f"/tmp/pilive/cmp-{tag}-{b}.png"
        subprocess.run(
            [PY, str(ROOT / "ansi2png.py"), src, png, "--title", f"{b} — {tag}", "--size", "14"],
            check=True, capture_output=True,
        )
        tiles.append((png, f"{b} {tag} — {note}"))

ims = [(Image.open(p), lab) for p, lab in tiles]
s = 0.62
tw, th = int(ims[0][0].width * s), int(ims[0][0].height * s)
gap, pad, lab_h = 14, 20, 28
font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 18)

W = pad * 2 + 2 * tw + gap
H = pad * 2 + 2 * (th + lab_h) + gap
sheet = Image.new("RGB", (W, H), (10, 10, 13))
d = ImageDraw.Draw(sheet)
for i, (im, lab) in enumerate(ims):
    r, c = divmod(i, 2)
    x = pad + c * (tw + gap)
    y = pad + r * (th + lab_h + gap)
    colour = (150, 230, 160) if "after" in lab else (235, 150, 150)
    d.text((x + 2, y + 4), lab, font=font, fill=colour)
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab_h))
sheet.save("/tmp/pilive/contrast-before-after.png")
print("/tmp/pilive/contrast-before-after.png", sheet.size)
