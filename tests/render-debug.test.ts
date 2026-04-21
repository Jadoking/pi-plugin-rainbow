import assert from "node:assert/strict";
import test from "node:test";

import {
  countChangedLines,
  getRainbowRenderDebugLogPath,
  isRainbowPostprocessCompactEnabled,
  isRainbowPostprocessProbeEnabled,
  isRainbowPostprocessRoundtripEnabled,
  isRainbowPostprocessSpikeEnabled,
  isRainbowRenderDebugEnabled,
} from "../extensions/rainbow/render-debug.js";

test("debug log path defaults to /tmp when render debug is enabled", () => {
  const env = { PI_RAINBOW_DEBUG_RENDER: "1" };

  assert.equal(getRainbowRenderDebugLogPath(env), "/tmp/pi-rainbow-render.log");
  assert.equal(isRainbowRenderDebugEnabled(env), true);
});

test("debug log path can be set explicitly and disabled with falsey values", () => {
  assert.equal(
    getRainbowRenderDebugLogPath({ PI_RAINBOW_DEBUG_RENDER: "/tmp/custom-rainbow.log" }),
    "/tmp/custom-rainbow.log",
  );
  assert.equal(getRainbowRenderDebugLogPath({ PI_RAINBOW_DEBUG_RENDER: "false" }), undefined);
  assert.equal(isRainbowRenderDebugEnabled({ PI_RAINBOW_DEBUG_RENDER: "0" }), false);
});

test("postprocess spike flags are parsed independently", () => {
  assert.equal(isRainbowPostprocessSpikeEnabled({ PI_RAINBOW_POSTPROCESS_SPIKE: "yes" }), true);
  assert.equal(isRainbowPostprocessProbeEnabled({ PI_RAINBOW_POSTPROCESS_PROBE: "on" }), true);
  assert.equal(isRainbowPostprocessRoundtripEnabled({ PI_RAINBOW_POSTPROCESS_ROUNDTRIP: "on" }), true);
  assert.equal(isRainbowPostprocessCompactEnabled({ PI_RAINBOW_POSTPROCESS_COMPACT: "on" }), true);
  assert.equal(isRainbowPostprocessProbeEnabled({ PI_RAINBOW_POSTPROCESS_PROBE: "off" }), false);
});

test("countChangedLines detects edits, additions, and removals", () => {
  assert.equal(countChangedLines(undefined, ["a", "b"]), 2);
  assert.equal(countChangedLines(["a", "b"], ["a", "b"]), 0);
  assert.equal(countChangedLines(["a", "b"], ["a", "c"]), 1);
  assert.equal(countChangedLines(["a", "b"], ["a"]), 1);
  assert.equal(countChangedLines(["a"], ["a", "b"]), 1);
});
