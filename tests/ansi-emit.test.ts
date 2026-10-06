import assert from "node:assert/strict";
import test from "node:test";

import { visibleWidth } from "@earendil-works/pi-tui";

import { emitAnsiGrid, emitAnsiGridCompact } from "../extensions/rainbow/ansi-emit.js";
import { parseAnsiGrid } from "../extensions/rainbow/ansi-grid.js";

test("compact emitter merges repeated sgr runs while keeping visible content identical", () => {
  const line = "\x1b[31mA\x1b[31mB\x1b[31mC\x1b[0m";
  const grid = parseAnsiGrid([line]);
  const exact = emitAnsiGrid(grid)[0]!;
  const compact = emitAnsiGridCompact(grid)[0]!;

  assert.equal(exact, line);
  assert.equal(compact, "\x1b[31mABC\x1b[0m");
  assert.equal(visibleWidth(compact), visibleWidth(line));
  assert.ok(Buffer.byteLength(compact, "utf8") < Buffer.byteLength(line, "utf8"));
});

test("compact emitter preserves osc markers and hyperlink boundaries", () => {
  const line = "\x1b]133;A\x07\x1b[31mA\x1b]8;;https://example.com\x07B\x1b]8;;\x07\x1b[31mC\x1b[0m";
  const compact = emitAnsiGridCompact(parseAnsiGrid([line]))[0]!;

  assert.match(compact, /^\x1b]133;A\x07\x1b\[31mA\x1b]8;;https:\/\/example.com\x07B\x1b]8;;\x07C\x1b\[0m$/);
  assert.equal(visibleWidth(compact), visibleWidth(line));
});

test("compact emitter handles style transitions canonically", () => {
  const line = "\x1b[1mA\x1b[22m\x1b[38;5;33mB\x1b[39mC\x1b[0m";
  const compact = emitAnsiGridCompact(parseAnsiGrid([line]))[0]!;

  assert.equal(compact, "\x1b[1mA\x1b[38;5;33mB\x1b[0mC\x1b[0m");
  assert.equal(visibleWidth(compact), visibleWidth(line));
});
