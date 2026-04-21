import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@mariozechner/pi-coding-agent";

import { RainbowSettingsDialog, renderPresetPreview } from "../extensions/rainbow/settings-dialog.js";
import { DEFAULT_SETTINGS } from "../extensions/rainbow/settings.js";

const mockTheme = {
  fg: (_token: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

test("renderPresetPreview renders ansi swatches for the selected preset", () => {
  const preview = renderPresetPreview("dracula");

  assert.match(preview, /\x1b\[38;2;255;85;85m██\x1b\[0m/);
  assert.match(preview, /\x1b\[38;2;189;147;249m██\x1b\[0m/);
});

test("settings dialog shows the selected palette preview on the preset option", () => {
  const dialog = new RainbowSettingsDialog(
    mockTheme,
    { ...DEFAULT_SETTINGS, preset: "dracula" },
    () => {},
    () => {},
  );

  const lines = dialog.render(90);

  assert.ok(lines.some((line) => line.includes("Palette ")), "expected a palette preview row");
  assert.ok(
    lines.some((line) => line.includes("\x1b[38;2;255;85;85m██\x1b[0m")),
    "expected the selected preset swatches to be rendered",
  );
});

test("settings dialog shows dedicated tool-box toggles", () => {
  const dialog = new RainbowSettingsDialog(
    mockTheme,
    { ...DEFAULT_SETTINGS, preset: "dracula" },
    () => {},
    () => {},
  );

  const lines = dialog.render(90);

  assert.ok(lines.some((line) => line.includes("Color tool boxes")));
  assert.ok(lines.some((line) => line.includes("Animate tool boxes")));
});

test("settings dialog wraps long descriptions so animation speed remains readable", () => {
  const dialog = new RainbowSettingsDialog(
    mockTheme,
    { ...DEFAULT_SETTINGS, preset: "dracula" },
    () => {},
    () => {},
  );

  const lines = dialog.render(64);

  assert.ok(lines.some((line) => line.includes("Animation speed")), "expected animation speed row to be visible");
  assert.ok(
    lines.some((line) => line.includes("Only animates while Pi is actively")),
    "expected the first part of the animation speed description",
  );
  assert.ok(
    lines.some((line) => line.includes("stays on the base palette")),
    "expected the wrapped continuation of the description",
  );
});
