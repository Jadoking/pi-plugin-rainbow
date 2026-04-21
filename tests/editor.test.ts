import assert from "node:assert/strict";
import test from "node:test";

import {
  getEditorAnimationDelayMs,
  getEditorLineColorMode,
  isEditorChromeLine,
  isEditorInputSettling,
} from "../extensions/rainbow/editor.js";
import { DEFAULT_SETTINGS } from "../extensions/rainbow/settings.js";

test("isEditorChromeLine detects editor border bars and scroll indicators", () => {
  assert.equal(isEditorChromeLine("────────────────────────"), true);
  assert.equal(isEditorChromeLine("\x1b[31m─── ↑ 3 more ─────────\x1b[0m"), true);
  assert.equal(isEditorChromeLine("hello world"), false);
});

test("getEditorLineColorMode keeps chrome animated while typed input stays plain by default", () => {
  assert.equal(getEditorLineColorMode("────────────────────────", DEFAULT_SETTINGS), "all");
  assert.equal(getEditorLineColorMode("typed input here", DEFAULT_SETTINGS), "none");
  assert.equal(
    getEditorLineColorMode("typed input here", { ...DEFAULT_SETTINGS, colorInput: true }),
    "all",
  );
});

test("editor animation backs off briefly after input to reduce prompt lag", () => {
  const baseDelay = getEditorAnimationDelayMs(DEFAULT_SETTINGS, false);
  const settlingDelay = getEditorAnimationDelayMs(DEFAULT_SETTINGS, true);

  assert.ok(settlingDelay > baseDelay);
  assert.equal(isEditorInputSettling(1000, 1100), true);
  assert.equal(isEditorInputSettling(1000, 1300), false);
});
