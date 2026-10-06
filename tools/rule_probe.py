#!/usr/bin/env python3
"""Dump the colour of a rule row, cell by cell, to characterise a gradient.

A rule should be a smooth sweep. Eyeballing a screenshot cannot distinguish
"noisy hue" from "bright spikes", and the two have different causes, so this
prints the actual per-cell values and the step-to-step delta.

Usage: rule_probe.py <capture.ans>
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ansi2png import parse  # noqa: E402

RULE_CHARS = set("─━═–—-▁▔_")


def main():
    lines = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines()
    grid, _ = parse(lines)

    for y, row in enumerate(grid):
        chars = [c for c, _, w in row if w]
        if len(chars) < 20:
            continue
        ruleish = sum(1 for c in chars if c in RULE_CHARS)
        if ruleish < len(chars) * 0.6:
            continue

        cols = [(st.fg or (0, 0, 0)) for c, st, w in row if w and c in RULE_CHARS]
        bolds = [st.bold for c, st, w in row if w and c in RULE_CHARS]
        if not cols:
            continue

        deltas = [
            sum(abs(a - b) for a, b in zip(cols[i], cols[i + 1]))
            for i in range(len(cols) - 1)
        ]
        lum = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in cols]
        print(f"\nrow {y}: {len(cols)} rule cells, bold={sum(bolds)}/{len(bolds)}")
        print(f"  luminance  min {min(lum):6.1f}  max {max(lum):6.1f}  spread {max(lum) - min(lum):6.1f}")
        print(f"  step delta mean {sum(deltas) / len(deltas):6.1f}  max {max(deltas):6.1f}")
        print("  first 12 cells:", " ".join(f"{r:>3},{g:>3},{b:>3}" for r, g, b in cols[:12]))


if __name__ == "__main__":
    main()
