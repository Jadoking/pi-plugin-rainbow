import assert from "node:assert/strict";
import test from "node:test";

import { RainbowAnimationController } from "../extensions/rainbow/runtime.js";

test("animation controller stays idle until explicitly started", () => {
  const controller = new RainbowAnimationController();

  assert.equal(controller.isAnimating(0), false);
  assert.equal(controller.getElapsedMs(0), 0);
});

test("animation controller runs during work and settles back to the initial state after a double-cycle stop", () => {
  const controller = new RainbowAnimationController();
  const speed = 0.008;

  controller.start(100);
  assert.equal(controller.isAnimating(160), true);
  assert.equal(controller.getElapsedMs(160), 60);

  controller.stop(speed, 160);
  assert.equal(controller.isAnimating(160), true);

  const phaseAtStop = controller.getElapsedMs(160) * speed * 0.1;
  const cycleProgress = phaseAtStop - Math.floor(phaseAtStop);
  const remainingMs = (2 - cycleProgress) / (speed * 0.1);
  const finishMs = 160 + remainingMs;

  assert.equal(controller.isAnimating(finishMs - 1), true);
  assert.equal(controller.isAnimating(finishMs + 1), false);
  assert.equal(controller.getElapsedMs(finishMs + 1), 0);
});

test("starting again while stopping resumes the same animation instead of snapping idle", () => {
  const controller = new RainbowAnimationController();

  controller.start(0);
  controller.stop(0.008, 125);
  assert.equal(controller.isAnimating(126), true);

  controller.start(140);
  assert.equal(controller.isAnimating(141), true);
  assert.ok(controller.getElapsedMs(141) > 0);
});
