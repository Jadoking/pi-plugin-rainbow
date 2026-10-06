#!/usr/bin/env python3
"""Contrast audit for a captured pi screen.

Readability is not a matter of taste: WCAG contrast is a number, and a
terminal UI that drops below about 3:1 for body text is objectively hard to
read. This parses a `tmux capture-pane -e` dump into cells, resolves every
glyph's effective foreground and background, and reports the distribution so a
tuning change can be judged against before/after figures instead of vibes.

Usage:  contrast_audit.py <capture.ans> [more.ans ...]
"""
import sys
import pathlib
from collections import Counter

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ansi2png import parse  # noqa: E402

DEFAULT_BG = (14, 14, 18)
DEFAULT_FG = (220, 220, 226)

# Glyphs that are decoration, not text. Judging these by contrast is wrong:
# a dim scanline or a particle is *supposed* to be low contrast.
DECOR = set(" ░▒▓█▀▄▌▐·∙•◦°˙⋅│┃║▏▎▍▋▊▉─━═┄┅┈┉╌╍▁▔_")


def luminance(c):
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = (ch(x) for x in c)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(fg, bg):
    a, b = luminance(fg), luminance(bg)
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def audit(path):
    lines = pathlib.Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    grid, _ = parse(lines)

    ratios = []
    worst = []
    for y, row in enumerate(grid):
        for x, (ch, st, w) in enumerate(row):
            if w == 0 or ch in DECOR or not ch.strip():
                continue
            fg = st.fg or DEFAULT_FG
            bg = st.bg or DEFAULT_BG
            if st.inverse:
                fg, bg = bg, fg
            r = contrast(fg, bg)
            ratios.append(r)
            worst.append((r, y, x, ch, fg, bg))

    if not ratios:
        return None
    ratios.sort()
    worst.sort(key=lambda t: t[0])
    n = len(ratios)
    buckets = Counter()
    for r in ratios:
        if r < 2.0:
            buckets["<2.0 unreadable"] += 1
        elif r < 3.0:
            buckets["2.0-3.0 poor"] += 1
        elif r < 4.5:
            buckets["3.0-4.5 ok"] += 1
        else:
            buckets["4.5+ good"] += 1

    return {
        "path": path,
        "cells": n,
        "min": ratios[0],
        "p05": ratios[int(n * 0.05)],
        "median": ratios[n // 2],
        "buckets": buckets,
        "worst": worst[:8],
    }


def main():
    for p in sys.argv[1:]:
        a = audit(p)
        if not a:
            print(f"{p}: no text cells")
            continue
        name = pathlib.Path(a["path"]).stem
        print(f"\n=== {name}  ({a['cells']} text cells) ===")
        print(f"  min {a['min']:.2f}   p05 {a['p05']:.2f}   median {a['median']:.2f}")
        for k in ("<2.0 unreadable", "2.0-3.0 poor", "3.0-4.5 ok", "4.5+ good"):
            c = a["buckets"].get(k, 0)
            print(f"  {k:18} {c:5d}  {100 * c / a['cells']:5.1f}%")
        print("  worst cells:")
        for r, y, x, ch, fg, bg in a["worst"][:5]:
            print(f"    {r:5.2f}  row{y:>3} col{x:>3}  {ch!r:>6}  fg={fg} bg={bg}")


if __name__ == "__main__":
    main()
