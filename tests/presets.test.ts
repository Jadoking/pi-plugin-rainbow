import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PRESET_ID,
  findRainbowPreset,
  getNextRainbowPresetId,
  getPreviousRainbowPresetId,
  normalizePresetId,
} from "../extensions/rainbow/presets.js";

test("normalizePresetId resolves aliases and falls back safely", () => {
  assert.equal(normalizePresetId("rose pine"), "rose-pine");
  assert.equal(normalizePresetId("tokyonight"), "tokyo-night");
  assert.equal(normalizePresetId("does-not-exist"), DEFAULT_PRESET_ID);
});

test("preset lookup and rotation cycle through the catalog", () => {
  assert.equal(findRainbowPreset("mocha")?.id, "catppuccin");
  assert.equal(getNextRainbowPresetId("classic-rainbow"), "catppuccin");
  assert.equal(getPreviousRainbowPresetId("classic-rainbow"), "night-owl");
});
