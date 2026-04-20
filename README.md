# pi-plugin-rainbow

Best-effort Pi Coding Agent port of `oc-plugin-rainbow`.

More or less useless bloat for an otherwise perfect agent. But at least it's fun bloat.

This package keeps the original plugin's core UX:

- animated rainbow foreground effect
- rainbow assistant output for plain markdown text
- adjustable color vibrance from pastel to vivid
- live settings UI with persistent per-user values
- `ctrl+shift+r` splash shortcut

It is intentionally Pi-native instead of a 1:1 renderer port. OpenCode exposes a whole-screen TUI post-process hook; Pi does not. This package rebuilds the effect around Pi's custom editor and overlay APIs.

## Install

```bash
pi install https://github.com/Jadoking/pi-plugin-rainbow.git
```

## What It Does

- replaces the default Pi editor with an animated rainbow editor
- decorates built-in assistant messages with cached rainbow rendering for plain text spans
- persists settings under `~/.pi/agent/state/pi-plugin-rainbow.json`
- adds `/rainbow-settings`
- adds `/rainbow-reset`
- adds `/rainbow-splash`
- adds `ctrl+shift+r`

## Defaults

- `enabled: true`
- `fg: true`
- `showStatus: false`
- `bg: false`
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

- `/rainbow-settings`: tune the effect live
- `/rainbow-reset`: restore defaults
- `/rainbow-splash`: show the centered splash overlay

## Notes

- This package targets interactive Pi CLI, not Ralph's non-interactive `pi --print --mode json` adapter path.
- Assistant output is patched at the component level, not via a whole-screen framebuffer hook.
- Styled markdown spans such as code blocks, links, and syntax-highlighted regions are intentionally preserved instead of being recolored blindly.
- For distributed installs, Pi core packages are intentionally listed as peers so the plugin patches the host runtime instead of a private duplicate copy.
