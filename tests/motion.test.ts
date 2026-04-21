import assert from "node:assert/strict";
import test from "node:test";

import {
  getRainbowColor,
  getRainbowPalette,
  normalizeVibrance,
  offsetRainbowBackgroundColor,
  offsetRainbowColor,
} from "../extensions/rainbow/motion.js";

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

test("preset-based palettes sample stable theme colors", () => {
  assert.deepEqual(getRainbowColor(0, "dracula"), { r: 255, g: 85, b: 85 });
  assert.deepEqual(getRainbowColor(1, "dracula"), { r: 255, g: 85, b: 85 });
});

test("offsetRainbowColor preserves syntax-highlighted runs instead of flattening them to the base preset", () => {
  const explicitSyntaxColor = { r: 255, g: 85, b: 85 };
  const phase = 0.37;

  const offset = offsetRainbowColor(explicitSyntaxColor, phase, "nord");
  const plainPreset = getRainbowColor(phase, "nord");

  assert.notDeepEqual(offset, explicitSyntaxColor);
  assert.notDeepEqual(offset, plainPreset);
});

test("offsetRainbowBackgroundColor keeps tool-box tinting dimmer than foreground recoloring", () => {
  const base = { r: 40, g: 50, b: 60 };
  const phase = 0.37;
  const foregroundOffset = offsetRainbowColor(base, phase, "dracula");
  const backgroundOffset = offsetRainbowBackgroundColor(base, phase, "dracula");
  const brightness = ({ r, g, b }: { r: number; g: number; b: number }) => r + g + b;

  assert.notDeepEqual(backgroundOffset, base);
  assert.ok(brightness(backgroundOffset) < brightness(foregroundOffset));
});

test("offsetRainbowBackgroundColor keeps clearer band separation while following the active preset", () => {
  const base = { r: 40, g: 50, b: 60 };
  const firstBand = offsetRainbowBackgroundColor(base, 0, "dracula");
  const secondBand = offsetRainbowBackgroundColor(base, 0.5, "dracula");
  const distance = Math.abs(firstBand.r - secondBand.r) + Math.abs(firstBand.g - secondBand.g) + Math.abs(firstBand.b - secondBand.b);

  assert.ok(distance > 60);
});
