#!/usr/bin/env python3
"""Build the bundle contact sheet from the rendered stills."""
from PIL import Image, ImageDraw, ImageFont

NAMES = [
    "default", "zen", "crt", "synthwave", "matrix", "inferno", "deepspace",
    "storm", "winter", "hanami", "aquarium", "party", "chaos",
]

imgs = [(n, Image.open(f"/tmp/rbshots/{n}.png")) for n in NAMES]
scale = 0.52
tw, th = int(imgs[0][1].width * scale), int(imgs[0][1].height * scale)
cols, gap, pad, lab = 3, 16, 24, 30
rows = (len(imgs) + cols - 1) // cols
font = ImageFont.truetype("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf", 20)

W = pad * 2 + cols * tw + (cols - 1) * gap
H = pad * 2 + rows * (th + lab) + (rows - 1) * gap
sheet = Image.new("RGB", (W, H), (10, 10, 13))
d = ImageDraw.Draw(sheet)
for i, (n, im) in enumerate(imgs):
    r, c = divmod(i, cols)
    x = pad + c * (tw + gap)
    y = pad + r * (th + lab + gap)
    d.text((x + 2, y + 4), n, font=font, fill=(200, 200, 212))
    sheet.paste(im.resize((tw, th), Image.LANCZOS), (x, y + lab))
sheet.save("/tmp/rbshots/contact-sheet.png")
print("/tmp/rbshots/contact-sheet.png", sheet.size)
