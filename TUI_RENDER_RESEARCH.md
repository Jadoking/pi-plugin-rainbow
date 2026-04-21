# TUI Render Research Notes

Branch: `tui-render`

## Goal

Build a tmux-friendlier animated renderer for `pi-plugin-rainbow` without modifying Pi source.

The core idea is to stop doing all rainbow work as component-local ANSI rewriting and instead:

1. intercept Pi's final rendered frame from the plugin
2. parse ANSI lines into a lightweight cell/grid structure
3. apply rainbow at the final-frame level
4. emit compact ANSI back out

This approximates OpenCode's post-process buffer model as closely as possible from plugin land.

---

## What is already done

### Phase 0: instrumentation

Added render/debug instrumentation.

Files:
- `extensions/rainbow/render-debug.ts`
- `extensions/rainbow/tui-hook.ts`
- trigger logging added in:
  - `extensions/rainbow/editor.ts`
  - `extensions/rainbow/settings-dialog.ts`
  - `extensions/rainbow/splash.ts`

What gets logged:
- render index
- request calls since last frame
- changed lines
- visible line count
- bytes written
- write count
- terminal width/height
- frame duration
- full redraw counters
- line bytes before/after postprocess
- SGR counts before/after postprocess
- plugin-side render triggers like:
  - `editor-store`
  - `editor-animation`
  - `editor-timer`
  - `settings-preview`
  - `settings-apply`
  - `splash-timer`

Debug log path:
- default: `/tmp/pi-rainbow-render.log`
- enabled with `PI_RAINBOW_DEBUG_RENDER=1`
- can also be set to a custom path by giving a file path instead of `1`

Useful raw ANSI capture:
- `PI_TUI_WRITE_LOG=/tmp/tui-ansi.log`

---

### Phase 1: final-frame hook spike

Proved we can intercept Pi's final frame from a plugin without changing Pi source.

Patch points currently used in `extensions/rainbow/tui-hook.ts`:
- `TUI.prototype.requestRender`
- `TUI.prototype.applyLineResets`
- `TUI.prototype.doRender`
- `ProcessTerminal.prototype.write`

Important result:
- final-frame interception works plugin-side
- current hook point is `applyLineResets`, i.e. after layout/compositing and before diff/output

Probe mode:
- `PI_RAINBOW_POSTPROCESS_SPIKE=1`
- `PI_RAINBOW_POSTPROCESS_PROBE=1`

This inserts a visible tint into the first visible non-empty line as proof the hook is active.

---

### Phase 2: ANSI grid round-trip

Built a lightweight ANSI grid.

Files:
- `extensions/rainbow/ansi-grid.ts`
- `extensions/rainbow/ansi-emit.ts`

Capabilities:
- parse final ANSI-rendered lines into cells
- preserve:
  - SGR color/style state
  - OSC 8 hyperlinks
  - OSC 133 prompt markers
  - other zero-width control sequences carried between cells
  - wide chars / emoji
- no-op round-trip back to ANSI

Important result:
- line -> grid -> line round-trip works and is test-covered

---

### Phase 3: compact ANSI emitter

Added a compact canonical emitter that merges repeated SGR runs.

Files:
- `extensions/rainbow/ansi-emit.ts`
- `extensions/rainbow/ansi-grid.ts`
- `extensions/rainbow/tui-hook.ts`

New spike mode:
- `PI_RAINBOW_POSTPROCESS_COMPACT=1`

Important result:
- can re-emit final frames with fewer SGR transitions than the original line stream
- metrics now report pre/post byte counts and SGR counts

---

### Phase 4: real final-frame rainbow

Added actual rainbow application at the final-frame level.

File:
- `extensions/rainbow/postprocess.ts`

Mode:
- default-on in `main`
- optional explicit enable: `PI_RAINBOW_POSTPROCESS_RAINBOW=1`
- opt-out: `PI_RAINBOW_POSTPROCESS_RAINBOW=0`

How it currently works:
- samples the active Pi theme into RGB marks
- identifies neutral foreground colors
- identifies tool box background colors
- recolors/tints the final-frame grid
- emits with compact ANSI

Integration details:
- `extensions/rainbow/index.ts`
  - configures frame postprocess runtime with settings + animation + theme
  - skips `installAssistantMessagePatch(store, animation)` in frame-postprocess mode to avoid double recoloring
- `extensions/rainbow/editor.ts`
  - returns plain base editor lines when frame-postprocess mode is enabled
  - still keeps animation timing alive so final-frame animation advances

Important result:
- plugin can now do rainbow at the final rendered frame level, not only by patching individual components

---

### Phase 5: tmux live-region freezing

Added a tmux-specific animation policy inside final-frame postprocess mode.

Files:
- `extensions/rainbow/postprocess.ts`
- `tests/postprocess.test.ts`

How it currently works:
- when frame-postprocess mode is active **and** rainbow animation is enabled inside tmux:
  - unchanged rows are reused from the previous already-emitted frame
  - changed rows are still re-rendered so content stays correct
  - **foreground text animation is disabled** in tmux (assistant/user text uses static rainbow colors)
  - OSC133-marked assistant blocks are not kept live for foreground animation
  - tool-box recoloring/animation overrides are disabled; tool output stays at Pi defaults
  - non-live rows remain frozen by cache reuse
- outside tmux, the full-frame renderer still behaves as before

Important result:
- tmux animation no longer needs to repaint/animate assistant foreground text each tick
- older/history rows freeze naturally
- expected flicker pressure is reduced by removing time-varying text colors in tmux

---

## Current feature flags

### Logging / spike flags
- `PI_RAINBOW_DEBUG_RENDER=1`
- `PI_RAINBOW_POSTPROCESS_SPIKE=1`
- `PI_RAINBOW_POSTPROCESS_PROBE=1`
- `PI_RAINBOW_POSTPROCESS_ROUNDTRIP=1`
- `PI_RAINBOW_POSTPROCESS_COMPACT=1`
- `PI_RAINBOW_POSTPROCESS_RAINBOW=1` (explicit enable)
- `PI_RAINBOW_POSTPROCESS_RAINBOW=0` (opt-out)

### Existing runtime behavior flags/settings
- `PI_RAINBOW_FORCE_ANIMATION=1`
- `PI_RAINBOW_DISABLE_ANIMATION=1`
- persisted setting: `animateInTmux`

---

## Recommended manual test commands

### 1. Baseline instrumentation

```bash
rm -f /tmp/pi-rainbow-render.log /tmp/tui-ansi.log
PI_RAINBOW_DEBUG_RENDER=1 \
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log \
pi --extension ./extensions/rainbow/index.ts
```

### 2. Hook proof

```bash
rm -f /tmp/pi-rainbow-render.log
PI_RAINBOW_DEBUG_RENDER=1 \
PI_RAINBOW_POSTPROCESS_SPIKE=1 \
PI_RAINBOW_POSTPROCESS_PROBE=1 \
pi --extension ./extensions/rainbow/index.ts
```

Expected:
- first visible non-empty line gets probe tint
- log shows probe postprocess mode

### 3. Compact no-op path

```bash
rm -f /tmp/pi-rainbow-render.log
PI_RAINBOW_DEBUG_RENDER=1 \
PI_RAINBOW_POSTPROCESS_SPIKE=1 \
PI_RAINBOW_POSTPROCESS_COMPACT=1 \
pi --extension ./extensions/rainbow/index.ts
```

Expected in log:
- `lineBytesAfterPostprocess < lineBytesBeforePostprocess` often
- `sgrCountAfterPostprocess < sgrCountBeforePostprocess` often

### 4. Real final-frame rainbow

```bash
rm -f /tmp/pi-rainbow-render.log /tmp/tui-ansi.log
PI_RAINBOW_POSTPROCESS_RAINBOW=1 \
PI_RAINBOW_DEBUG_RENDER=1 \
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log \
pi --extension ./extensions/rainbow/index.ts
```

Expected in log:
- `postprocess: "rainbow"`

Run this both:
- outside tmux
- inside tmux

### 5. tmux live-region behavior check

Inside tmux, with animation re-enabled:

```bash
rm -f /tmp/pi-rainbow-render.log /tmp/tui-ansi.log
PI_RAINBOW_POSTPROCESS_RAINBOW=1 \
PI_RAINBOW_DEBUG_RENDER=1 \
PI_RAINBOW_FORCE_ANIMATION=1 \
PI_TUI_WRITE_LOG=/tmp/tui-ansi.log \
pi --extension ./extensions/rainbow/index.ts
```

What to watch for:
- older visible rows should stop changing every frame
- assistant/user foreground text should stay visually stable while streaming
- tool boxes should stay at Pi defaults (no rainbow tool-box animation)
- `changedLines` and terminal bytes written should drop relative to full-frame animation

---

## Test status

Latest state before compaction:
- `npm test` passes
- `npm run typecheck` passes

Added tests include:
- `tests/render-debug.test.ts`
- `tests/tui-hook.test.ts`
- `tests/ansi-grid.test.ts`
- `tests/ansi-emit.test.ts`
- `tests/postprocess.test.ts`

---

## Important architectural decisions already made

1. **Final-frame hook is viable plugin-side**
   - no Pi source changes required so far

2. **Frame-postprocess mode should avoid double work**
   - when `PI_RAINBOW_POSTPROCESS_RAINBOW=1`, `installAssistantMessagePatch(...)` is skipped
   - editor returns plain base lines so final-frame pass owns recoloring

3. **Compact ANSI emission is necessary**
   - exact round-trip is useful for correctness
   - compact emission is the path we want for tmux-friendlier output

4. **This is still experimental**
   - hooking private TUI internals may be version-brittle

---

## What still needs to happen next

### Phase 6: further tmux churn reduction / shipping decision

Phase 5 is now in place, but it is still heuristic.

Next things to try:
1. quantize animation bands or colors further in tmux
2. make live-region detection more semantic instead of purely line-diff / latest-tool-block based
3. compare tmux logs before/after on real streaming sessions using:
   - `changedLines`
   - `bytesWritten`
   - `lineBytesAfterPostprocess`
   - `sgrCountAfterPostprocess`
4. decide whether final-frame postprocess should become the default tmux path

### Phase 7: choose shipping mode

Possible final outcome:
- keep old component renderer for normal terminals
- use final-frame postprocess renderer for tmux
- or switch entirely if it proves better everywhere

---

## Risks / caveats

- patching Pi internals may break across Pi releases
- final-frame parsing/re-emission may still be too expensive on very busy frames
- region-detection for "live" vs "history" may be non-trivial
- final-frame recoloring currently relies on sampled theme colors and heuristics

---

## Short summary for future continuation

We have already proven the most important unknowns:
- plugin-side final-frame interception works
- ANSI line -> grid -> line works
- compact ANSI emission works
- real rainbow can be applied at the final-frame level

The immediate next optimization target is **making tmux live-region detection even cheaper and more semantic**, now that basic history freezing is already working.
