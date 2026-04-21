import assert from "node:assert/strict";
import test from "node:test";

import {
  colorCodeToRgb,
  colorizeToolBoxLine,
  getAssistantAnimationFrame,
  getParsedRainbowLine,
  getToolAnimationFrame,
  updateBackgroundColorCode,
  updateForegroundColorCode,
} from "../extensions/rainbow/assistant-patch.js";
import { createRainbowMotion } from "../extensions/rainbow/motion.js";

test("updateForegroundColorCode tracks only foreground SGR state", () => {
  let code: string | null = null;

  code = updateForegroundColorCode(code, "\x1b[48;2;1;2;3m");
  assert.equal(code, null);

  code = updateForegroundColorCode(code, "\x1b[38;5;123m");
  assert.equal(code, "38;5;123");

  code = updateForegroundColorCode(code, "\x1b[39m");
  assert.equal(code, null);
});

test("colorCodeToRgb decodes truecolor and 256-color foregrounds and backgrounds", () => {
  assert.deepEqual(colorCodeToRgb("38;2;10;20;30"), { r: 10, g: 20, b: 30 });
  assert.deepEqual(colorCodeToRgb("38;5;196"), { r: 255, g: 0, b: 0 });
  assert.deepEqual(colorCodeToRgb("48;2;1;2;3"), { r: 1, g: 2, b: 3 });
  assert.deepEqual(colorCodeToRgb("48;5;46"), { r: 0, g: 255, b: 0 });
});


test("updateBackgroundColorCode tracks only background SGR state", () => {
  let code: string | null = null;

  code = updateBackgroundColorCode(code, "\x1b[38;2;1;2;3m");
  assert.equal(code, null);

  code = updateBackgroundColorCode(code, "\x1b[48;5;120m");
  assert.equal(code, "48;5;120");

  code = updateBackgroundColorCode(code, "\x1b[49m");
  assert.equal(code, null);
});

test("getParsedRainbowLine preserves explicit foreground runs across resets", () => {
  const parsed = getParsedRainbowLine("\x1b[38;2;10;20;30mA\x1b[39mB");
  const textTokens = parsed.tokens.filter((token) => token.type === "text");

  assert.equal(textTokens.length, 2);
  assert.deepEqual(textTokens[0], {
    type: "text",
    value: "A",
    width: 1,
    explicitFg: { r: 10, g: 20, b: 30 },
    restoreFgAnsi: "\x1b[38;2;10;20;30m",
  });
  assert.deepEqual(textTokens[1], {
    type: "text",
    value: "B",
    width: 1,
    explicitFg: null,
    restoreFgAnsi: "\x1b[39m",
  });
});

test("getAssistantAnimationFrame animates only the latest assistant block", () => {
  const latest = getAssistantAnimationFrame({ renderOrder: 3 }, 3, 0.008, 250);
  const older = getAssistantAnimationFrame({ renderOrder: 2 }, 3, 0.008, 250);

  assert.equal(latest.isLatest, true);
  assert.ok(latest.frame > 0);
  assert.equal(older.isLatest, false);
  assert.equal(older.elapsedMs, 0);
  assert.equal(older.frame, 0);
});

test("getToolAnimationFrame animates pending tool boxes and freezes them on completion", () => {
  const pending = getToolAnimationFrame({ renderOrder: 4 }, 4, 0.008, 264, true, true);
  const completed = getToolAnimationFrame({ renderOrder: 4, frozenFrame: pending.nextFrozenFrame }, 4, 0.008, 330, true, false);
  const disabled = getToolAnimationFrame({ renderOrder: 4, frozenFrame: 7 }, 4, 0.008, 330, false, true);

  assert.ok(pending.frame > 0);
  assert.equal(completed.frame, pending.frame);
  assert.equal(completed.elapsedMs, 0);
  assert.equal(disabled.frame, 7);
});

test("colorizeToolBoxLine rainbow-tints tool box backgrounds while leaving plain text unchanged", () => {
  const motion = createRainbowMotion(16, 1, 3, 0, 0.008, 0.17);
  const line = "\x1b[48;2;40;50;60m tool \x1b[49m";
  const tinted = colorizeToolBoxLine(line, 0, motion, "dracula", 0.35);

  assert.notEqual(tinted, line);
  assert.match(tinted, /\x1b\[48;2;\d+;\d+;\d+m/);
  assert.equal(colorizeToolBoxLine("plain text", 0, motion, "dracula", 0.35), "plain text");
});
