#!/usr/bin/env python3
"""Stack the input-box band from successive live frames to show the gradient travel.

A video proves motion but makes it hard to see *what* is moving. Stacking the
same few rows from frames taken a fraction of a second apart turns the travel
into a diagonal, which is readable at a glance.
"""
import glob
from PIL import Image, ImageDraw, ImageFont

frames = sorted(glob.glob("/tmp/pilive/anim/p*.png"))
picks = [frames[i] for i in (0, 6, 12, 18, 24, 30, 36, 42)]

first = Image.open(picks[0])
W, H = first.size
# The input box sits near the bottom; take the band around its two rules.
top, bot = int(H * 0.790), int(H * 0.880)
band_h = bot - top

font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 15)
pad, gap, lab_w = 16, 6, 74

sheet = Image.new("RGB", (pad * 2 + lab_w + W, pad * 2 + len(picks) * (band_h + gap)), (10, 10, 13))
d = ImageDraw.Draw(sheet)
for i, p in enumerate(picks):
    im = Image.open(p).crop((0, top, W, bot))
    y = pad + i * (band_h + gap)
    d.text((pad, y + band_h // 2 - 8), f"t+{i * 6 * 0.12:4.2f}s", font=font, fill=(190, 190, 200))
    sheet.paste(im, (pad + lab_w, y))

sheet.save("/tmp/pilive/travel-filmstrip.png")
print("/tmp/pilive/travel-filmstrip.png", sheet.size)
