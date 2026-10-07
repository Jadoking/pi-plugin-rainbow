# pi-plugin-rainbow

Best-effort Pi Coding Agent port of `oc-plugin-rainbow`.

NOTE: I just realized that I my desire to create something similar to the original plugin I locked scrolling due to constant frame rendering. I will look for a solution but I do not believe it is possible due to how pi renders things.

More or less useless bloat for an otherwise perfect agent. But at least it's fun bloat.

This package now leans into Pi-friendly color theming:

- preset-driven rainbow and theme-inspired foreground palettes
- request-progress animation that only runs while Pi is working, then settles back to the base palette
- tmux-friendly rendering that uses a coarser animation path to reduce redraw jitter, plus settings/env controls for motion
- rainbow assistant output for plain markdown text
- live settings UI with persistent per-user values
- `ctrl+shift+r` splash shortcut

It is intentionally Pi-native instead of a 1:1 renderer port. OpenCode exposes a whole-screen TUI post-process hook; Pi does not. This package rebuilds the effect around Pi's custom editor and overlay APIs.

## Install

```bash
pi install https://github.com/Jadoking/pi-plugin-rainbow.git
```

## What It Does

- decorates assistant output and request-time previews with palette animation by default
- lets you tune tmux animation behavior in settings
- keeps animation focused on assistant text and the prompt entry area
- decorates built-in assistant messages with cached palette rendering for plain text spans
- ships presets based on popular palettes like Catppuccin, Dracula, Gruvbox, Nord, Tokyo Night, and more
- persists settings under `~/.pi/agent/state/pi-plugin-rainbow.json`
- adds `/rainbow-settings`
- adds `/rainbow-reset`
- adds `/rainbow-preset [list|next|prev|name]`
- adds `/rainbow-splash`
- adds `ctrl+shift+r`

## Defaults

- `enabled: true`
- `fg: true`
- `colorInput: true`
- `colorToolBoxes: false`
- `animateToolBoxes: false`
- `animateInTmux: false`
- `showStatus: false`
- `bg: false`
- `preset: classic-rainbow`
- `speed: 0.008`
- `turns: 3`
- `vibrance: 0.35`
- `glow: 0.05`

## Local Development

Install dependencies:

```bash
npm install
```

Typecheck:

```bash
npm run typecheck
```

Run tests:

```bash
npm run test
```

Run Pi with the extension directly from this package directory:

```bash
pi --extension ./extensions/rainbow/index.ts
```

## Packaging

This repository is structured as a Pi package:

- package keyword: `pi-package`
- package manifest: `pi.extensions`

Once published to npm or a git remote, it can be installed with Pi's package flow instead of using `--extension` directly.

## Compatibility

- tested against Pi `0.67.x`
- imports Pi core packages from the host runtime via `peerDependencies`
- relies on Pi internal component patching, so future Pi major changes may require plugin updates
- owns Pi's custom editor slot, so it may conflict with other editor-replacement plugins

## Commands

- `/rainbow-settings`: tune the palette and effects with an animated box preview. Use ↑↓ to select, ←→ to adjust intensity, and Space to toggle an effect.
- `/rainbow-fx <id> [0..1]`: toggle or set an effect; `list` shows effects and `none` disables them.
- `/rainbow-reset`: restore defaults
- `/rainbow-preset [list|next|prev|name]`: browse or switch presets
- `/rainbow-splash`: show the centered splash overlay

## Notes

- This package targets interactive Pi CLI, not Ralph's non-interactive `pi --print --mode json` adapter path.
- Assistant output is patched at the component level, not via a whole-screen framebuffer hook.
- Styled markdown spans such as code blocks, links, and syntax-highlighted regions are intentionally preserved instead of being recolored blindly.
- In `panels` scope, effects reach filled tool boxes and outlined side boxes. Adjacent prose receives foreground color only; editor contents and the footer stay untouched.
- In `/rainbow-settings`, **box strength** controls box backgrounds independently of text blend. 0% keeps the original fill; 100% uses the palette colour. Brightness, vibrance, and effects still apply; disable effects for an unmodified palette. Text contrast is corrected automatically. The default is a subtle 15% tint.
- The settings preview uses the same effect engine as the session. The outer screen effect pauses while settings are open so the preview is not processed twice.
- The final-frame postprocess renderer is enabled by default. You can temporarily opt out with `PI_RAINBOW_POSTPROCESS_RAINBOW=0`.
- When Pi runs inside tmux, the plugin uses a tmux-friendlier rendering path with much lower ANSI churn. Live animation is still reduced to static by default to avoid multiplexer redraw jitter, but you can re-enable motion with the `Animate in tmux` setting or `PI_RAINBOW_FORCE_ANIMATION=1`.
- For distributed installs, Pi core packages are intentionally listed as peers so the plugin patches the host runtime instead of a private duplicate copy.
