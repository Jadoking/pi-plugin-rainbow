#!/usr/bin/env python3
"""Render every /tmp/rbscript/<bundle>/frame-*.ans dir to f%04d.png."""
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
from ansi2png import render  # noqa: E402

ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/rbscript")
SIZE = int(sys.argv[2]) if len(sys.argv) > 2 else 13

for d in sorted(ROOT.iterdir()):
    if not d.is_dir():
        continue
    frames = sorted(d.glob("frame-*.ans"))
    for i, f in enumerate(frames):
        render(
            f.read_text(encoding="utf-8", errors="replace").splitlines(),
            str(d / f"f{i:04d}.png"),
            font_size=SIZE,
            title=f"pi — rainbow: {d.name}",
            radius=0,
        )
    print(f"{d.name}: {len(frames)} png", flush=True)
