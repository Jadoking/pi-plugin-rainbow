#!/usr/bin/env python3
"""Turn a directory of ANSI frame dumps into PNGs and an animated GIF."""

from __future__ import annotations

import argparse
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from PIL import Image

from ansi2png import render


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frame_dir")
    ap.add_argument("output", help="output .gif")
    ap.add_argument("--size", type=int, default=13)
    ap.add_argument("--title", default=None)
    ap.add_argument("--fps", type=float, default=20)
    ap.add_argument("--colors", type=int, default=256)
    ap.add_argument("--still", default=None, help="also write the brightest frame here")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.frame_dir, "frame-*.ans")))
    if not files:
        raise SystemExit(f"no frames in {args.frame_dir}")

    frames = []
    brightest = (-1.0, None)
    for i, f in enumerate(files):
        lines = open(f, encoding="utf-8").read().rstrip("\n").split("\n")
        png = os.path.join(args.frame_dir, f"f{i:04d}.png")
        render(lines, png, font_size=args.size, title=args.title, radius=0)
        im = Image.open(png).convert("RGB")
        frames.append(im)
        stat = sum(list(im.resize((48, 32)).convert("L").getdata()))
        if stat > brightest[0]:
            brightest = (stat, png)

    if args.still and brightest[1]:
        Image.open(brightest[1]).save(args.still)

    pal = frames[0].quantize(colors=args.colors, method=Image.Quantize.MEDIANCUT)
    gif = [f.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG) for f in frames]
    gif[0].save(
        args.output,
        save_all=True,
        append_images=gif[1:],
        duration=int(1000 / args.fps),
        loop=0,
        optimize=True,
        disposal=2,
    )
    size = os.path.getsize(args.output)
    print(f"{args.output} {len(frames)} frames {frames[0].size[0]}x{frames[0].size[1]} {size/1024:.0f}KB")
    if args.still:
        print(f"brightest -> {args.still}")


if __name__ == "__main__":
    main()
