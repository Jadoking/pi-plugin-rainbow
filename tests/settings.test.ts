import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PRESET_ID } from "../extensions/rainbow/presets.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../extensions/rainbow/settings.js";

test("normalizeSettings clamps distribution-facing numeric settings", () => {
  const normalized = normalizeSettings({
    bg: true,
    preset: "not-a-real-preset",
    speed: -10,
    turns: 99,
    vibrance: 42,
  });

  assert.equal(normalized.bg, false);
  assert.equal(normalized.preset, DEFAULT_PRESET_ID);
  assert.equal(normalized.speed, 0);
  assert.equal(normalized.turns, 8);
  assert.equal(normalized.vibrance, 1);
});

test("normalizeSettings keeps the preset, editor, tool-box, footer, and vibrance defaults", () => {
  const normalized = normalizeSettings(undefined);

  assert.equal(normalized.preset, DEFAULT_SETTINGS.preset);
  assert.equal(normalized.colorInput, DEFAULT_SETTINGS.colorInput);
  assert.equal(normalized.colorToolBoxes, DEFAULT_SETTINGS.colorToolBoxes);
  assert.equal(normalized.animateToolBoxes, DEFAULT_SETTINGS.animateToolBoxes);
  assert.equal(normalized.showStatus, DEFAULT_SETTINGS.showStatus);
  assert.equal(normalized.vibrance, DEFAULT_SETTINGS.vibrance);
});
