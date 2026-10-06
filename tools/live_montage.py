#!/usr/bin/env python3
"""Montage of real pi sessions captured with `tmux capture-pane -e`."""
from PIL import Image, ImageDraw, ImageFont

TILES = [
    ("/tmp/pilive/f-synthwave.png", "synthwave — tool block + editor tinted"),
    ("/tmp/pilive/f-inferno.png", "inferno — one colour per block row"),
    ("/tmp/pilive/f-aquarium.png", "aquarium — prose left alone"),
    ("/tmp/pilive/dialog.png", "/rainbow-settings — applies live"),
]

ims = [(Image.open(p), lab) for p, lab in TILES]
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
    d.text((x + 2, y + 4), lab, font=font, fill=(205, 205, 215))
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab_h))
sheet.save("/tmp/pilive/live-montage.png")
print("/tmp/pilive/live-montage.png", sheet.size)
