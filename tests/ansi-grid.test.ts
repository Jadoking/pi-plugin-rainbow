import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@mariozechner/pi-tui";

import { emitAnsiGrid } from "../extensions/rainbow/ansi-emit.js";
import { parseAnsiGrid, parseAnsiLine } from "../extensions/rainbow/ansi-grid.js";

const roundTrip = (lines: string[]) => {
  return emitAnsiGrid(parseAnsiGrid(lines));
};

test("plain text lines round-trip exactly", () => {
  const lines = ["hello", "plain text", ""]; 

  assert.deepEqual(roundTrip(lines), lines);
});

test("truecolor ansi runs round-trip exactly", () => {
  const lines = ["\x1b[38;2;10;20;30mhello\x1b[0m world"];

  assert.deepEqual(roundTrip(lines), lines);
});

test("osc8 hyperlinks survive parse and emit", () => {
  const lines = ["\x1b]8;;https://example.com\x07click\x1b]8;;\x07 here"];

  assert.deepEqual(roundTrip(lines), lines);
});

test("osc133 prompt markers survive parse and emit", () => {
  const lines = ["\x1b]133;A\x07user prompt", "\x1b]133;B\x07\x1b]133;C\x07done"];

  assert.deepEqual(roundTrip(lines), lines);
});

test("wide characters and emoji keep their visible width", () => {
  const lines = ["rainbow 😄 你好 🌈"];
  const parsed = parseAnsiLine(lines[0]!);
  const emitted = emitAnsiGrid({ lines: [parsed] })[0]!;

  assert.equal(visibleWidth(emitted), visibleWidth(lines[0]!));
  assert.equal(emitted, lines[0]);
  assert.ok(parsed.cells.some((cell) => cell.width > 1));
});

test("mixed sgr resets preserve prefix, cell metadata, and suffix order", () => {
  const line = "\x1b]133;A\x07\x1b[31mA\x1b[39m\x1b[48;5;25m好\x1b[49m\x1b]8;;https://example.com\x07Z\x1b]8;;\x07";
  const parsed = parseAnsiLine(line);

  assert.equal(parsed.prefix, "\x1b]133;A\x07\x1b[31m");
  assert.equal(parsed.cells.length, 3);
  assert.equal(parsed.cells[0]!.text, "A");
  assert.equal(parsed.cells[0]!.fgCode, "31");
  assert.equal(parsed.cells[1]!.text, "好");
  assert.equal(parsed.cells[1]!.bgCode, "48;5;25");
  assert.equal(parsed.cells[2]!.before, "\x1b[49m\x1b]8;;https://example.com\x07");
  assert.equal(parsed.suffix, "\x1b]8;;\x07");
  assert.equal(emitAnsiGrid({ lines: [parsed] })[0], line);
});
