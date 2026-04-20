import assert from "node:assert/strict";
import test from "node:test";

import { getRainbowPalette, normalizeVibrance } from "../extensions/rainbow/motion.js";

test("normalizeVibrance clamps to supported range", () => {
  assert.equal(normalizeVibrance(-1), 0);
  assert.equal(normalizeVibrance(2), 1);
});

test("higher vibrance increases saturation and reduces washout", () => {
  const soft = getRainbowPalette(0);
  const vivid = getRainbowPalette(1);

  assert.ok(vivid.saturation > soft.saturation);
  assert.ok(vivid.lightness < soft.lightness);
});
