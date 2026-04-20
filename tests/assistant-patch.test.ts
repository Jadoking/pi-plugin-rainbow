import assert from "node:assert/strict";
import test from "node:test";

import {
  colorCodeToRgb,
  getParsedRainbowLine,
  updateForegroundColorCode,
} from "../extensions/rainbow/assistant-patch.js";

test("updateForegroundColorCode tracks only foreground SGR state", () => {
  let code: string | null = null;

  code = updateForegroundColorCode(code, "\x1b[48;2;1;2;3m");
  assert.equal(code, null);

  code = updateForegroundColorCode(code, "\x1b[38;5;123m");
  assert.equal(code, "38;5;123");

  code = updateForegroundColorCode(code, "\x1b[39m");
  assert.equal(code, null);
});

test("colorCodeToRgb decodes truecolor and 256-color foregrounds", () => {
  assert.deepEqual(colorCodeToRgb("38;2;10;20;30"), { r: 10, g: 20, b: 30 });
  assert.deepEqual(colorCodeToRgb("38;5;196"), { r: 255, g: 0, b: 0 });
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
