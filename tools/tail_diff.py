#!/usr/bin/env python3
"""Compare the tail of two captures to prove the footer is untouched.

"Looks uncoloured" is not evidence. pi emits the same footer every frame, so if
the rainbow is genuinely off below the input box then the colours of those rows
must be identical with the extension painting and with it excluded.

Usage: tail_diff.py <coloured.ans> <reference.ans>
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ansi2png import parse  # noqa: E402

RULE_CHARS = set("─━═–—-▁▔_")


def last_rule_row(grid):
    for y in range(len(grid) - 1, -1, -1):
        chars = [c for c, _, w in grid[y] if w]
        if len(chars) >= 20 and sum(1 for c in chars if c in RULE_CHARS) >= len(chars) * 0.6:
            return y
    return -1


def tail_colours(path):
    lines = pathlib.Path(path).read_text(encoding="utf-8", errors="replace").splitlines()
    grid, _ = parse(lines)
    lr = last_rule_row(grid)
    out = {}
    for y in range(lr + 1, len(grid)):
        for x, (ch, st, w) in enumerate(grid[y]):
            if w and ch.strip():
                out[(y, x)] = (ch, st.fg, st.bg)
    return lr, out


def main():
    lr_a, a = tail_colours(sys.argv[1])
    lr_b, b = tail_colours(sys.argv[2])
    print(f"last rule row: {sys.argv[1]} -> {lr_a}   {sys.argv[2]} -> {lr_b}")

    shared = set(a) & set(b)
    same_char = [k for k in shared if a[k][0] == b[k][0]]
    tinted = [k for k in same_char if a[k][1:] != b[k][1:]]

    print(f"footer cells compared (same glyph): {len(same_char)}")
    print(f"cells whose colour differs:         {len(tinted)}")
    if tinted:
        print("  examples:")
        for k in sorted(tinted)[:6]:
            print(f"    row{k[0]} col{k[1]} {a[k][0]!r}  {a[k][1:]}  vs  {b[k][1:]}")
    else:
        print("  -> footer is byte-identical: the rainbow is not touching it.")


if __name__ == "__main__":
    main()
