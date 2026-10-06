#!/usr/bin/env python3
"""Four beats of the scripted sample session, as one labelled strip.

Frame n maps to t = (warm + n) / fps, so with --t0 2 --fps 20 the first
emitted frame is already at t=2s. Getting that wrong mislabels every tile.
"""
from PIL import Image, ImageDraw, ImageFont

WARM, FPS, LOOP = 40, 20, 9.0
SRC = "/tmp/rbscript/synthwave"

PICKS = [
    (150, "idle — no tool call, editor clean"),
    (10, "tool call open, output streaming"),
    (50, "tool output complete"),
    (100, "answer in, next prompt typed"),
]

ims = []
for n, lab in PICKS:
    beat = ((WARM + n) / FPS) % LOOP
    ims.append((Image.open(f"{SRC}/f{n:04d}.png"), f"{beat:.1f}s  {lab}"))

s = 0.60
tw, th = int(ims[0][0].width * s), int(ims[0][0].height * s)
gap, pad, lab_h = 14, 20, 26
font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 18)

W = pad * 2 + 2 * tw + gap
H = pad * 2 + 2 * (th + lab_h) + gap
sh = Image.new("RGB", (W, H), (10, 10, 13))
d = ImageDraw.Draw(sh)
for i, (im, lab) in enumerate(ims):
    r, c = divmod(i, 2)
    x = pad + c * (tw + gap)
    y = pad + r * (th + lab_h + gap)
    d.text((x + 2, y + 2), lab, font=font, fill=(205, 205, 215))
    sh.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab_h))
sh.save("/tmp/rbshots/session-beats.png")
print("/tmp/rbshots/session-beats.png", sh.size)
