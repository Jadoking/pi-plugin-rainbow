#!/usr/bin/env python3
"""Build the 2x2 scope comparison sheet."""
from PIL import Image, ImageDraw, ImageFont

NAMES = ["screen", "panels", "chrome", "text"]
BLURB = {
    "screen": "everything (old behaviour)",
    "panels": "rules + editor + tool blocks",
    "chrome": "separator rules only",
    "text": "foregrounds, no bg tint",
}

imgs = [(n, Image.open(f"/tmp/rbscope/{n}.png")) for n in NAMES]
s = 0.62
tw, th = int(imgs[0][1].width * s), int(imgs[0][1].height * s)
gap, pad, lab = 14, 20, 28
font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 19)

W = pad * 2 + 2 * tw + gap
H = pad * 2 + 2 * (th + lab) + gap
sheet = Image.new("RGB", (W, H), (10, 10, 13))
d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(imgs):
    r, c = divmod(i, 2)
    x = pad + c * (tw + gap)
    y = pad + r * (th + lab + gap)
    d.text((x + 2, y + 2), f"{n}  —  {BLURB[n]}", font=font, fill=(205, 205, 215))
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab))
sheet.save("/tmp/rbshots/scopes.png")
print("/tmp/rbshots/scopes.png", sheet.size)
