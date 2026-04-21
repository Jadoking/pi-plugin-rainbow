import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@mariozechner/pi-tui";

import { parseAnsiLine } from "../extensions/rainbow/ansi-grid.js";
import { applyRainbowFramePostprocess, isRainbowFramePostprocessEnabled } from "../extensions/rainbow/postprocess.js";
import { DEFAULT_SETTINGS } from "../extensions/rainbow/settings.js";

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

const theme = {
  fg(token: string, text: string) {
    const palette: Record<string, string> = {
      text: "\x1b[38;2;200;200;200m",
      muted: "\x1b[38;2;150;150;150m",
      dim: "\x1b[38;2;120;120;120m",
      border: "\x1b[38;2;90;90;90m",
      borderMuted: "\x1b[38;2;80;80;80m",
      userMessageText: "\x1b[38;2;210;210;210m",
    };
    return `${palette[token] ?? palette.text}${text}\x1b[39m`;
  },
  bg(token: string, text: string) {
    const palette: Record<string, string> = {
      toolPendingBg: "\x1b[48;2;20;40;60m",
      toolSuccessBg: "\x1b[48;2;20;60;40m",
      toolErrorBg: "\x1b[48;2;60;20;20m",
    };
    return `${palette[token] ?? palette.toolPendingBg}${text}\x1b[49m`;
  },
};

test("frame postprocess flag is default-on with explicit opt-out", () => {
  assert.equal(isRainbowFramePostprocessEnabled({}), true);
  assert.equal(isRainbowFramePostprocessEnabled({ PI_RAINBOW_POSTPROCESS_RAINBOW: "1" }), true);
  assert.equal(isRainbowFramePostprocessEnabled({ PI_RAINBOW_POSTPROCESS_RAINBOW: "false" }), false);
});

test("frame postprocess recolors sampled neutral foregrounds while preserving explicit non-neutral colors", () => {
  const lines = ["\x1b]133;A\x07\x1b[38;2;200;200;200mA\x1b[39m \x1b[38;2;255;0;0mB\x1b[39m"];
  const output = applyRainbowFramePostprocess(
    lines,
    { renderIndex: 1, width: 12, height: 1 },
    {
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false }),
      getElapsedMs: () => 125,
      getTheme: () => theme,
    },
  );

  const parsed = parseAnsiLine(output[0]!);
  assert.equal(parsed.prefixNonSgr, "\x1b]133;A\x07");
  assert.notDeepEqual(parsed.cells[0]!.fg, { r: 200, g: 200, b: 200 });
  assert.deepEqual(parsed.cells[1]!.fg, null);
  assert.deepEqual(parsed.cells[2]!.fg, { r: 255, g: 0, b: 0 });
  assert.equal(visibleWidth(output[0]!), visibleWidth(lines[0]!));
});

test("frame postprocess keeps default tool box colors when tool overrides are disabled", () => {
  const lines = ["\x1b[48;2;20;40;60mX\x1b[49m \x1b[48;2;1;2;3mY\x1b[49m"];
  const output = applyRainbowFramePostprocess(
    lines,
    { renderIndex: 1, width: 8, height: 1 },
    {
      getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: false, colorToolBoxes: true, animateToolBoxes: true }),
      getElapsedMs: () => 180,
      getTheme: () => theme,
    },
  );

  const parsed = parseAnsiLine(output[0]!);
  assert.deepEqual(parsed.cells[0]!.bg, { r: 20, g: 40, b: 60 });
  assert.deepEqual(parsed.cells[2]!.bg, { r: 1, g: 2, b: 3 });
  assert.equal(visibleWidth(output[0]!), visibleWidth(lines[0]!));
});

test("tmux frame postprocess freezes unchanged history rows between animation ticks", () => {
  const cache = {};
  let elapsedMs = 120;
  const lines = [
    "\x1b[38;2;200;200;200molder\x1b[39m",
    "\x1b[38;2;150;150;150mhistory\x1b[39m",
  ];
  const runtime = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false, animateInTmux: true }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    cache,
  };

  const first = applyRainbowFramePostprocess(lines, { renderIndex: 1, width: 20, height: 6 }, runtime);
  elapsedMs = 240;
  const second = applyRainbowFramePostprocess(lines, { renderIndex: 2, width: 20, height: 6 }, runtime);

  assert.deepEqual(second, first);
});

test("tmux frame postprocess keeps marked assistant blocks static between ticks when foreground animation is disabled", () => {
  const cache = {};
  let elapsedMs = 120;
  let nowMs = 1000;
  const lines = [
    "\x1b[38;2;200;200;200molder\x1b[39m",
    `${OSC133_ZONE_START}\x1b[38;2;200;200;200mfirst\x1b[39m`,
    "\x1b[38;2;150;150;150msecond\x1b[39m",
    "\x1b[38;2;120;120;120mthird\x1b[39m",
    "\x1b[38;2;90;90;90mfourth\x1b[39m",
    "\x1b[38;2;80;80;80mfifth\x1b[39m",
    "\x1b[38;2;210;210;210msixth\x1b[39m",
    `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}\x1b[38;2;200;200;200mseventh\x1b[39m`,
  ];
  const runtime = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false, animateInTmux: true }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    getNowMs: () => nowMs,
    cache,
  };

  const first = applyRainbowFramePostprocess(lines, { renderIndex: 1, width: 40, height: 12 }, runtime);
  elapsedMs = 240;
  nowMs = 1200;
  const second = applyRainbowFramePostprocess(lines, { renderIndex: 2, width: 40, height: 12 }, runtime);

  assert.deepEqual(second, first);

  elapsedMs = 360;
  nowMs = 1900;
  const third = applyRainbowFramePostprocess(lines, { renderIndex: 3, width: 40, height: 12 }, runtime);

  assert.deepEqual(third, second);
});

test("tmux frame postprocess keeps foreground colors stable across ticks for marked rows", () => {
  const cache = {};
  let elapsedMs = 120;
  let nowMs = 1000;
  const lines = [
    `${OSC133_ZONE_START}\x1b[38;2;200;200;200mabcdefghijklmnopqrstuvwxyz0123456789\x1b[39m${OSC133_ZONE_END}${OSC133_ZONE_FINAL}`,
  ];
  const runtime = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false, animateInTmux: true }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    getNowMs: () => nowMs,
    cache,
  };

  const first = applyRainbowFramePostprocess(lines, { renderIndex: 1, width: 80, height: 6 }, runtime);
  elapsedMs = 240;
  nowMs = 1100;
  const second = applyRainbowFramePostprocess(lines, { renderIndex: 2, width: 80, height: 6 }, runtime);

  const firstCells = parseAnsiLine(first[0]!).cells.filter((cell) => cell.width > 0 && /\S/u.test(cell.text));
  const secondCells = parseAnsiLine(second[0]!).cells.filter((cell) => cell.width > 0 && /\S/u.test(cell.text));
  const firstFg = firstCells.map((cell) => `${cell.fg?.r ?? -1},${cell.fg?.g ?? -1},${cell.fg?.b ?? -1}`);
  const secondFg = secondCells.map((cell) => `${cell.fg?.r ?? -1},${cell.fg?.g ?? -1},${cell.fg?.b ?? -1}`);

  assert.deepEqual(secondFg, firstFg);
});

test("tmux frame postprocess keeps tool box rows stable when tool overrides are disabled", () => {
  const cache = {};
  let elapsedMs = 120;
  const lines = [
    "\x1b[38;2;200;200;200molder\x1b[39m",
    "",
    "\x1b[48;2;20;40;60mtool\x1b[49m",
  ];
  const runtime = {
    getSettings: () => ({
      ...DEFAULT_SETTINGS,
      enabled: true,
      fg: true,
      colorToolBoxes: true,
      animateToolBoxes: true,
      animateInTmux: true,
    }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    cache,
  };

  const first = applyRainbowFramePostprocess(lines, { renderIndex: 1, width: 20, height: 8 }, runtime);
  elapsedMs = 240;
  const second = applyRainbowFramePostprocess(lines, { renderIndex: 2, width: 20, height: 8 }, runtime);

  assert.equal(second[0], first[0]);
  assert.equal(second[2], first[2]);
});

test("tmux frame postprocess re-animates only the changed live region when new output arrives", () => {
  const cache = {};
  let elapsedMs = 120;
  const firstLines = [
    "\x1b[38;2;200;200;200molder\x1b[39m",
    "",
    "\x1b[38;2;150;150;150mworking\x1b[39m",
  ];
  const secondLines = [
    "\x1b[38;2;200;200;200molder\x1b[39m",
    "",
    "\x1b[38;2;150;150;150mdone\x1b[39m",
  ];
  const runtime = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false, animateInTmux: true }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    cache,
  };

  const first = applyRainbowFramePostprocess(firstLines, { renderIndex: 1, width: 20, height: 8 }, runtime);
  elapsedMs = 240;
  const second = applyRainbowFramePostprocess(secondLines, { renderIndex: 2, width: 20, height: 8 }, runtime);

  assert.equal(second[0], first[0]);
  assert.notEqual(second[2], first[2]);
});

test("tmux frame postprocess invalidates frozen rows when the rainbow settings change", () => {
  const cache = {};
  let elapsedMs = 120;
  let preset = DEFAULT_SETTINGS.preset;
  const lines = ["\x1b[38;2;200;200;200molder\x1b[39m"];
  const runtime = {
    getSettings: () => ({ ...DEFAULT_SETTINGS, enabled: true, fg: true, colorToolBoxes: false, animateInTmux: true, preset }),
    getElapsedMs: () => elapsedMs,
    getTheme: () => theme,
    getEnv: () => ({ TMUX: "/tmp/tmux-1000/default,123,0" }),
    cache,
  };

  const first = applyRainbowFramePostprocess(lines, { renderIndex: 1, width: 20, height: 6 }, runtime);
  elapsedMs = 240;
  preset = "dracula";
  const second = applyRainbowFramePostprocess(lines, { renderIndex: 2, width: 20, height: 6 }, runtime);

  assert.notDeepEqual(second, first);
});
