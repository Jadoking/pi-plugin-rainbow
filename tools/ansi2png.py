#!/usr/bin/env python3
"""Render an ANSI (truecolor) terminal dump to a PNG.

Parses SGR sequences into a cell grid, then draws each cell with a monospace
font. Uses a font chain so block/box/symbol glyphs that the primary font lacks
fall back to Noto Sans Symbols 2 rather than rendering as tofu.
"""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from dataclasses import dataclass, replace

from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont

# ---------------------------------------------------------------- fonts

FONT_CHAIN = [
    ("/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Regular.ttf",
     "/usr/share/fonts/adwaita-mono-fonts/AdwaitaMono-Bold.ttf"),
    ("/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf",
     "/usr/share/fonts/google-noto-vf/NotoSansMono[wght].ttf"),
    ("/usr/share/fonts/google-noto/NotoSansSymbols2-Regular.ttf",
     "/usr/share/fonts/google-noto/NotoSansSymbols2-Regular.ttf"),
    ("/usr/share/fonts/gdouros-symbola/Symbola.ttf",
     "/usr/share/fonts/gdouros-symbola/Symbola.ttf"),
]


class FontSet:
    def __init__(self, size: int):
        self.size = size
        self.regular = []
        self.bold = []
        self.cmaps = []
        for reg, bold in FONT_CHAIN:
            try:
                self.regular.append(ImageFont.truetype(reg, size))
                self.bold.append(ImageFont.truetype(bold, size))
                self.cmaps.append(set(TTFont(reg, fontNumber=0, lazy=True).getBestCmap().keys()))
            except Exception:
                continue
        if not self.regular:
            raise SystemExit("no usable fonts found")

    def pick(self, ch: str, bold: bool):
        cp = ord(ch)
        for i, cmap in enumerate(self.cmaps):
            if cp in cmap:
                return (self.bold if bold else self.regular)[i]
        return (self.bold if bold else self.regular)[0]


# ---------------------------------------------------------------- ansi

XTERM256 = None


def build_xterm256():
    out = []
    base = [
        (0, 0, 0), (205, 0, 0), (0, 205, 0), (205, 205, 0),
        (0, 0, 238), (205, 0, 205), (0, 205, 205), (229, 229, 229),
        (127, 127, 127), (255, 0, 0), (0, 255, 0), (255, 255, 0),
        (92, 92, 255), (255, 0, 255), (0, 255, 255), (255, 255, 255),
    ]
    out.extend(base)
    levels = [0, 95, 135, 175, 215, 255]
    for r in levels:
        for g in levels:
            for b in levels:
                out.append((r, g, b))
    for i in range(24):
        v = 8 + i * 10
        out.append((v, v, v))
    return out


XTERM256 = build_xterm256()

SGR_RE = re.compile(r"\x1b\[([0-9;:]*)m")
ANY_ESC_RE = re.compile(r"\x1b\[[0-9;:?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")


@dataclass(frozen=True)
class Style:
    fg: tuple | None = None
    bg: tuple | None = None
    bold: bool = False
    dim: bool = False
    italic: bool = False
    underline: bool = False
    inverse: bool = False


def apply_sgr(style: Style, params: str) -> Style:
    if params == "":
        return Style()
    parts = [p for p in params.replace(":", ";").split(";")]
    i = 0
    while i < len(parts):
        p = parts[i]
        n = int(p) if p.isdigit() else 0
        if n == 0:
            style = Style()
        elif n == 1:
            style = replace(style, bold=True)
        elif n == 2:
            style = replace(style, dim=True)
        elif n == 3:
            style = replace(style, italic=True)
        elif n == 4:
            style = replace(style, underline=True)
        elif n == 7:
            style = replace(style, inverse=True)
        elif n == 22:
            style = replace(style, bold=False, dim=False)
        elif n == 23:
            style = replace(style, italic=False)
        elif n == 24:
            style = replace(style, underline=False)
        elif n == 27:
            style = replace(style, inverse=False)
        elif n == 39:
            style = replace(style, fg=None)
        elif n == 49:
            style = replace(style, bg=None)
        elif 30 <= n <= 37:
            style = replace(style, fg=XTERM256[n - 30])
        elif 90 <= n <= 97:
            style = replace(style, fg=XTERM256[n - 90 + 8])
        elif 40 <= n <= 47:
            style = replace(style, bg=XTERM256[n - 40])
        elif 100 <= n <= 107:
            style = replace(style, bg=XTERM256[n - 100 + 8])
        elif n in (38, 48):
            target = "fg" if n == 38 else "bg"
            mode = int(parts[i + 1]) if i + 1 < len(parts) and parts[i + 1].isdigit() else -1
            if mode == 2 and i + 4 < len(parts):
                col = tuple(int(parts[i + k]) if parts[i + k].isdigit() else 0 for k in (2, 3, 4))
                style = replace(style, **{target: col})
                i += 4
            elif mode == 5 and i + 2 < len(parts):
                idx = int(parts[i + 2]) if parts[i + 2].isdigit() else 0
                style = replace(style, **{target: XTERM256[idx % 256]})
                i += 2
        i += 1
    return style


def char_width(ch: str) -> int:
    if unicodedata.combining(ch):
        return 0
    return 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1


def parse(lines: list[str]):
    """-> (grid rows of (char, Style), max_width)"""
    grid = []
    width = 0
    style = Style()
    for raw in lines:
        row = []
        pos = 0
        i = 0
        while i < len(raw):
            if raw[i] == "\x1b":
                m = SGR_RE.match(raw, i)
                if m:
                    style = apply_sgr(style, m.group(1))
                    i = m.end()
                    continue
                m = ANY_ESC_RE.match(raw, i)
                if m:
                    i = m.end()
                    continue
                i += 1
                continue
            ch = raw[i]
            i += 1
            w = char_width(ch)
            if w == 0:
                continue
            row.append((ch, style, w))
            pos += w
            if w == 2:
                row.append(("", style, 0))
        grid.append(row)
        width = max(width, len(row))
    return grid, width


# ---------------------------------------------------------------- render

def render(lines, out_path, font_size=16, pad=18, line_gap=2, default_bg=(14, 14, 18),
           default_fg=(220, 220, 226), title=None, radius=10):
    fonts = FontSet(font_size)
    probe = Image.new("RGB", (10, 10))
    d = ImageDraw.Draw(probe)
    bbox = d.textbbox((0, 0), "M", font=fonts.regular[0])
    cw = max(1, int(round(fonts.regular[0].getlength("M"))))
    ascent, descent = fonts.regular[0].getmetrics()
    ch_h = ascent + descent + line_gap

    grid, cols = parse(lines)
    rows = len(grid)
    title_h = int(ch_h * 1.6) if title else 0
    W = cols * cw + pad * 2
    H = rows * ch_h + pad * 2 + title_h

    img = Image.new("RGB", (W, H), default_bg)
    draw = ImageDraw.Draw(img)

    if title:
        draw.rectangle([0, 0, W, title_h], fill=(26, 26, 32))
        for i, c in enumerate([(255, 95, 86), (255, 189, 46), (39, 201, 63)]):
            x = pad + i * 18
            draw.ellipse([x, title_h // 2 - 6, x + 12, title_h // 2 + 6], fill=c)
        draw.text((pad + 70, title_h // 2 - ch_h // 2), title,
                  font=fonts.regular[0], fill=(150, 150, 160))

    y0 = pad + title_h
    for ry, row in enumerate(grid):
        y = y0 + ry * ch_h
        for cx, (ch, style, w) in enumerate(row):
            if w == 0 and ch == "":
                continue
            fg = style.fg or default_fg
            bg = style.bg or default_bg
            if style.inverse:
                fg, bg = bg, fg
            if style.dim:
                fg = tuple(int(v * 0.58) for v in fg)
            x = pad + cx * cw
            if bg != default_bg:
                draw.rectangle([x, y, x + cw * w, y + ch_h], fill=bg)
            if ch and ch != " ":
                font = fonts.pick(ch, style.bold)
                draw.text((x, y), ch, font=font, fill=fg)
            if style.underline:
                draw.line([x, y + ascent + 1, x + cw * w, y + ascent + 1], fill=fg)

    if radius:
        mask = Image.new("L", (W, H), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, H - 1], radius=radius, fill=255)
        bgimg = Image.new("RGB", (W, H), (0, 0, 0))
        bgimg.paste(img, (0, 0), mask)
        img = bgimg

    img.save(out_path)
    return out_path, W, H


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="ANSI dump file, or - for stdin")
    ap.add_argument("output")
    ap.add_argument("--size", type=int, default=16)
    ap.add_argument("--title", default=None)
    args = ap.parse_args()

    data = sys.stdin.read() if args.input == "-" else open(args.input, encoding="utf-8").read()
    lines = data.rstrip("\n").split("\n")
    path, w, h = render(lines, args.output, font_size=args.size, title=args.title)
    print(f"{path} {w}x{h}")


if __name__ == "__main__":
    main()
