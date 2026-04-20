import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SETTINGS, normalizeSettings } from "../extensions/rainbow/settings.js";

test("normalizeSettings clamps distribution-facing numeric settings", () => {
  const normalized = normalizeSettings({
    bg: true,
    speed: -10,
    turns: 99,
    vibrance: 42,
  });

  assert.equal(normalized.bg, false);
  assert.equal(normalized.speed, 0);
  assert.equal(normalized.turns, 8);
  assert.equal(normalized.vibrance, 1);
});

test("normalizeSettings keeps the new footer and vibrance defaults", () => {
  const normalized = normalizeSettings(undefined);

  assert.equal(normalized.showStatus, DEFAULT_SETTINGS.showStatus);
  assert.equal(normalized.vibrance, DEFAULT_SETTINGS.vibrance);
});
