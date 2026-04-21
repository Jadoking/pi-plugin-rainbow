import assert from "node:assert/strict";
import test from "node:test";

import {
  getAnimationSuppressionReason,
  getEffectiveAnimationSpeed,
  isRainbowAnimationDisabled,
  isTmuxSession,
} from "../extensions/rainbow/terminal.js";

test("tmux sessions automatically suppress rainbow animation by default", () => {
  const env = { TMUX: "/tmp/tmux-1000/default,123,0" };

  assert.equal(isTmuxSession(env), true);
  assert.equal(isRainbowAnimationDisabled({}, env), true);
  assert.equal(getEffectiveAnimationSpeed(0.008, {}, env), 0);
  assert.equal(getAnimationSuppressionReason({}, env), "tmux");
});

test("animateInTmux restores animation without requiring an env override", () => {
  const env = { TMUX: "/tmp/tmux-1000/default,123,0" };
  const policy = { animateInTmux: true };

  assert.equal(isRainbowAnimationDisabled(policy, env), false);
  assert.equal(getEffectiveAnimationSpeed(0.008, policy, env), 0.008);
  assert.equal(getAnimationSuppressionReason(policy, env), undefined);
});

test("force flag restores animation inside tmux", () => {
  const env = {
    TMUX: "/tmp/tmux-1000/default,123,0",
    PI_RAINBOW_FORCE_ANIMATION: "1",
  };

  assert.equal(isRainbowAnimationDisabled({}, env), false);
  assert.equal(getEffectiveAnimationSpeed(0.008, {}, env), 0.008);
  assert.equal(getAnimationSuppressionReason({}, env), undefined);
});

test("disable flag wins regardless of terminal or settings", () => {
  const env = {
    PI_RAINBOW_DISABLE_ANIMATION: "true",
    PI_RAINBOW_FORCE_ANIMATION: "1",
  };
  const policy = { animateInTmux: true };

  assert.equal(isRainbowAnimationDisabled(policy, env), true);
  assert.equal(getEffectiveAnimationSpeed(0.008, policy, env), 0);
  assert.equal(getAnimationSuppressionReason(policy, env), "env");
});
