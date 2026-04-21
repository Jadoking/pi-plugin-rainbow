import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@mariozechner/pi-tui";

import {
  applyPostprocessProbe,
  insertAfterLeadingEscapeSequences,
  shouldInstallRainbowTuiHooks,
} from "../extensions/rainbow/tui-hook.js";

test("insertAfterLeadingEscapeSequences preserves prompt markers at the start of the line", () => {
  const line = "\x1b]133;A\x07\x1b[2mHello\x1b[0m";
  const result = insertAfterLeadingEscapeSequences(line, "\x1b[38;5;213m");

  assert.equal(result.startsWith("\x1b]133;A\x07\x1b[2m\x1b[38;5;213mHello"), true);
});

test("applyPostprocessProbe colors the first visible line without changing visible width", () => {
  const lines = ["", "\x1b]133;A\x07Hello\x1b[0m", "World\x1b[0m"];
  const probed = applyPostprocessProbe(lines);

  assert.notEqual(probed, lines);
  assert.equal(probed[0], lines[0]);
  assert.equal(probed[2], lines[2]);
  assert.equal(visibleWidth(probed[1]!), visibleWidth(lines[1]!));
  assert.match(probed[1]!, /^\x1b]133;A\x07\x1b\[38;5;213m/);
});

test("tui hooks install by default with explicit opt-out available", () => {
  const originalEnv = {
    PI_RAINBOW_DEBUG_RENDER: process.env.PI_RAINBOW_DEBUG_RENDER,
    PI_RAINBOW_POSTPROCESS_SPIKE: process.env.PI_RAINBOW_POSTPROCESS_SPIKE,
    PI_RAINBOW_POSTPROCESS_RAINBOW: process.env.PI_RAINBOW_POSTPROCESS_RAINBOW,
  };

  try {
    process.env.PI_RAINBOW_DEBUG_RENDER = "0";
    process.env.PI_RAINBOW_POSTPROCESS_SPIKE = "0";
    delete process.env.PI_RAINBOW_POSTPROCESS_RAINBOW;
    assert.equal(shouldInstallRainbowTuiHooks(), true);

    process.env.PI_RAINBOW_POSTPROCESS_RAINBOW = "0";
    assert.equal(shouldInstallRainbowTuiHooks(), false);

    process.env.PI_RAINBOW_DEBUG_RENDER = "1";
    assert.equal(shouldInstallRainbowTuiHooks(), true);

    process.env.PI_RAINBOW_DEBUG_RENDER = "0";
    process.env.PI_RAINBOW_POSTPROCESS_SPIKE = "1";
    assert.equal(shouldInstallRainbowTuiHooks(), true);

    process.env.PI_RAINBOW_POSTPROCESS_SPIKE = "0";
    process.env.PI_RAINBOW_POSTPROCESS_RAINBOW = "1";
    assert.equal(shouldInstallRainbowTuiHooks(), true);
  } finally {
    if (originalEnv.PI_RAINBOW_DEBUG_RENDER === undefined) {
      delete process.env.PI_RAINBOW_DEBUG_RENDER;
    } else {
      process.env.PI_RAINBOW_DEBUG_RENDER = originalEnv.PI_RAINBOW_DEBUG_RENDER;
    }

    if (originalEnv.PI_RAINBOW_POSTPROCESS_SPIKE === undefined) {
      delete process.env.PI_RAINBOW_POSTPROCESS_SPIKE;
    } else {
      process.env.PI_RAINBOW_POSTPROCESS_SPIKE = originalEnv.PI_RAINBOW_POSTPROCESS_SPIKE;
    }

    if (originalEnv.PI_RAINBOW_POSTPROCESS_RAINBOW === undefined) {
      delete process.env.PI_RAINBOW_POSTPROCESS_RAINBOW;
    } else {
      process.env.PI_RAINBOW_POSTPROCESS_RAINBOW = originalEnv.PI_RAINBOW_POSTPROCESS_RAINBOW;
    }
  }
});
