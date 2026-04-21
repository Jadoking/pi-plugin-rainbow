import type { AnsiGrid, AnsiGridLine } from "./ansi-grid.js";

const RESET = "\x1b[0m";

export const emitAnsiLine = (line: AnsiGridLine) => {
  return line.prefix + line.cells.map((cell) => `${cell.before}${cell.text}`).join("") + line.suffix;
};

export const emitAnsiGrid = (grid: AnsiGrid) => {
  return grid.lines.map((line) => emitAnsiLine(line));
};

export const emitAnsiLineCompact = (line: AnsiGridLine) => {
  if (line.cells.length === 0) {
    return line.prefix + line.suffix;
  }

  let result = line.prefixNonSgr;
  let currentStyleKey = "";

  for (const cell of line.cells) {
    result += cell.beforeNonSgr;

    if (cell.styleKey !== currentStyleKey) {
      result += cell.styleAnsi || RESET;
      currentStyleKey = cell.styleKey;
    }

    result += cell.text;
  }

  return result + line.suffix;
};

export const emitAnsiGridCompact = (grid: AnsiGrid) => {
  return grid.lines.map((line) => emitAnsiLineCompact(line));
};
