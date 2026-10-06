#!/usr/bin/env python3
"""Render every bundle's ANSI frame dir to PNGs (used by the showcase build)."""
import glob
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__))))
from ansi2png import render

bundles = sys.argv[1:] or [
    "default", "synthwave", "matrix", "inferno", "aquarium", "party", "storm", "chaos",
]
for b in bundles:
    d = f"/tmp/rbgif/{b}"
    files = sorted(glob.glob(d + "/frame-*.ans"))
    for i, f in enumerate(files):
        lines = open(f, encoding="utf-8").read().rstrip("\n").split("\n")
        render(lines, f"{d}/f{i:04d}.png", font_size=13, title=f"pi \u2014 rainbow: {b}", radius=0)
    print(f"{b}: {len(files)} png", flush=True)
