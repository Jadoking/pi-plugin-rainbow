import { visibleWidth } from "@earendil-works/pi-tui";

export type RGB = {
  r: number;
  g: number;
  b: number;
};

export type AnsiColorCode = string | null;

export type AnsiStyleState = {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  blink: boolean;
  inverse: boolean;
  hidden: boolean;
  strike: boolean;
  overline: boolean;
  fgCode: AnsiColorCode;
  bgCode: AnsiColorCode;
};

export type AnsiCell = {
  text: string;
  width: number;
  before: string;
  beforeNonSgr: string;
  fgCode: AnsiColorCode;
  bgCode: AnsiColorCode;
  fg: RGB | null;
  bg: RGB | null;
  style: AnsiStyleState;
  styleKey: string;
  styleAnsi: string;
};

export type AnsiGridLine = {
  prefix: string;
  prefixNonSgr: string;
  cells: AnsiCell[];
  suffix: string;
  suffixNonSgr: string;
  visibleWidth: number;
};

export type AnsiGrid = {
  lines: AnsiGridLine[];
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const BASIC_ANSI_COLORS: RGB[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
];

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const createStyleState = (): AnsiStyleState => ({
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  blink: false,
  inverse: false,
  hidden: false,
  strike: false,
  overline: false,
  fgCode: null,
  bgCode: null,
});

const cloneStyleState = (style: AnsiStyleState): AnsiStyleState => ({ ...style });

export const styleStateKey = (style: AnsiStyleState) => {
  return [
    style.bold ? "1" : "",
    style.dim ? "2" : "",
    style.italic ? "3" : "",
    style.underline ? "4" : "",
    style.blink ? "5" : "",
    style.inverse ? "7" : "",
    style.hidden ? "8" : "",
    style.strike ? "9" : "",
    style.overline ? "53" : "",
    style.fgCode ?? "",
    style.bgCode ?? "",
  ].join("|");
};

export const styleStateToAnsi = (style: AnsiStyleState) => {
  const parts: string[] = [];

  if (style.bold) parts.push("1");
  if (style.dim) parts.push("2");
  if (style.italic) parts.push("3");
  if (style.underline) parts.push("4");
  if (style.blink) parts.push("5");
  if (style.inverse) parts.push("7");
  if (style.hidden) parts.push("8");
  if (style.strike) parts.push("9");
  if (style.overline) parts.push("53");
  if (style.fgCode) parts.push(style.fgCode);
  if (style.bgCode) parts.push(style.bgCode);

  return parts.length > 0 ? `\x1b[${parts.join(";")}m` : "";
};

export const readEscapeSequence = (line: string, index: number) => {
  if (index >= line.length || line.charCodeAt(index) !== 0x1b) {
    return undefined;
  }

  const next = line[index + 1];
  if (next === "[") {
    let end = index + 2;
    while (end < line.length && !(line.charCodeAt(end) >= 0x40 && line.charCodeAt(end) <= 0x7e)) {
      end += 1;
    }
    if (end < line.length) {
      return line.slice(index, end + 1);
    }
    return undefined;
  }

  if (next === "]" || next === "_" || next === "P") {
    let end = index + 2;
    while (end < line.length) {
      if (line.charCodeAt(end) === 0x07) {
        return line.slice(index, end + 1);
      }
      if (line.charCodeAt(end) === 0x1b && line[end + 1] === "\\") {
        return line.slice(index, Math.min(end + 2, line.length));
      }
      end += 1;
    }
  }

  return undefined;
};

const ansi256ToRgb = (index: number): RGB => {
  const normalized = clamp(index, 0, 255);
  if (normalized < 16) {
    return BASIC_ANSI_COLORS[normalized]!;
  }

  if (normalized >= 232) {
    const gray = 8 + (normalized - 232) * 10;
    return { r: gray, g: gray, b: gray };
  }

  const cubeIndex = normalized - 16;
  const red = Math.floor(cubeIndex / 36);
  const green = Math.floor((cubeIndex % 36) / 6);
  const blue = cubeIndex % 6;
  const toChannel = (value: number) => (value === 0 ? 0 : 55 + value * 40);

  return {
    r: toChannel(red),
    g: toChannel(green),
    b: toChannel(blue),
  };
};

export const colorCodeToRgb = (colorCode: string | null): RGB | null => {
  if (!colorCode) {
    return null;
  }

  if (colorCode.startsWith("38;2;") || colorCode.startsWith("48;2;")) {
    const parts = colorCode.split(";").slice(2).map((part) => Number.parseInt(part, 10));
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      return {
        r: clamp(parts[0]!, 0, 255),
        g: clamp(parts[1]!, 0, 255),
        b: clamp(parts[2]!, 0, 255),
      };
    }

    return null;
  }

  if (colorCode.startsWith("38;5;") || colorCode.startsWith("48;5;")) {
    const index = Number.parseInt(colorCode.split(";")[2] ?? "", 10);
    return Number.isFinite(index) ? ansi256ToRgb(index) : null;
  }

  const basic = Number.parseInt(colorCode, 10);
  if (!Number.isFinite(basic)) {
    return null;
  }

  if (basic >= 30 && basic <= 37) {
    return BASIC_ANSI_COLORS[basic - 30]!;
  }

  if (basic >= 90 && basic <= 97) {
    return BASIC_ANSI_COLORS[basic - 82]!;
  }

  if (basic >= 40 && basic <= 47) {
    return BASIC_ANSI_COLORS[basic - 40]!;
  }

  if (basic >= 100 && basic <= 107) {
    return BASIC_ANSI_COLORS[basic - 92]!;
  }

  return null;
};

const applySgrSequenceToStyle = (style: AnsiStyleState, sequence: string) => {
  if (!sequence.endsWith("m")) {
    return style;
  }

  const match = sequence.match(/\x1b\[([\d;]*)m/);
  if (!match) {
    return style;
  }

  const params = match[1] === "" ? ["0"] : (match[1] ?? "").split(";");
  const next = cloneStyleState(style);

  for (let index = 0; index < params.length; ) {
    const code = Number.parseInt(params[index] ?? "", 10);
    if (Number.isNaN(code)) {
      index += 1;
      continue;
    }

    switch (code) {
      case 0:
        Object.assign(next, createStyleState());
        index += 1;
        continue;
      case 1:
        next.bold = true;
        index += 1;
        continue;
      case 2:
        next.dim = true;
        index += 1;
        continue;
      case 3:
        next.italic = true;
        index += 1;
        continue;
      case 4:
      case 21:
        next.underline = true;
        index += 1;
        continue;
      case 5:
      case 6:
        next.blink = true;
        index += 1;
        continue;
      case 7:
        next.inverse = true;
        index += 1;
        continue;
      case 8:
        next.hidden = true;
        index += 1;
        continue;
      case 9:
        next.strike = true;
        index += 1;
        continue;
      case 22:
        next.bold = false;
        next.dim = false;
        index += 1;
        continue;
      case 23:
        next.italic = false;
        index += 1;
        continue;
      case 24:
        next.underline = false;
        index += 1;
        continue;
      case 25:
        next.blink = false;
        index += 1;
        continue;
      case 27:
        next.inverse = false;
        index += 1;
        continue;
      case 28:
        next.hidden = false;
        index += 1;
        continue;
      case 29:
        next.strike = false;
        index += 1;
        continue;
      case 39:
        next.fgCode = null;
        index += 1;
        continue;
      case 49:
        next.bgCode = null;
        index += 1;
        continue;
      case 53:
        next.overline = true;
        index += 1;
        continue;
      case 55:
        next.overline = false;
        index += 1;
        continue;
      case 38:
        if (params[index + 1] === "5" && params[index + 2] !== undefined) {
          next.fgCode = `38;5;${params[index + 2]}`;
          index += 3;
          continue;
        }
        if (params[index + 1] === "2" && params[index + 4] !== undefined) {
          next.fgCode = `38;2;${params[index + 2]};${params[index + 3]};${params[index + 4]}`;
          index += 5;
          continue;
        }
        index += 1;
        continue;
      case 48:
        if (params[index + 1] === "5" && params[index + 2] !== undefined) {
          next.bgCode = `48;5;${params[index + 2]}`;
          index += 3;
          continue;
        }
        if (params[index + 1] === "2" && params[index + 4] !== undefined) {
          next.bgCode = `48;2;${params[index + 2]};${params[index + 3]};${params[index + 4]}`;
          index += 5;
          continue;
        }
        index += 1;
        continue;
      default:
        if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          next.fgCode = String(code);
          index += 1;
          continue;
        }
        if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
          next.bgCode = String(code);
          index += 1;
          continue;
        }
        index += 1;
        continue;
    }
  }

  return next;
};

export const parseAnsiLine = (line: string): AnsiGridLine => {
  const cells: AnsiCell[] = [];
  let prefix = "";
  let prefixNonSgr = "";
  let pendingRaw = "";
  let pendingNonSgr = "";
  let currentStyle = createStyleState();

  for (let index = 0; index < line.length; ) {
    if (line.charCodeAt(index) === 0x1b) {
      const sequence = readEscapeSequence(line, index);
      if (sequence) {
        pendingRaw += sequence;
        if (sequence.endsWith("m")) {
          currentStyle = applySgrSequenceToStyle(currentStyle, sequence);
        } else {
          pendingNonSgr += sequence;
        }
        index += sequence.length;
        continue;
      }
    }

    let nextEscape = index;
    while (nextEscape < line.length && line.charCodeAt(nextEscape) !== 0x1b) {
      nextEscape += 1;
    }

    const chunk = line.slice(index, nextEscape);
    for (const { segment } of segmenter.segment(chunk)) {
      const width = visibleWidth(segment);
      if (width === 0) {
        pendingRaw += segment;
        pendingNonSgr += segment;
        continue;
      }

      const style = cloneStyleState(currentStyle);
      const before = cells.length === 0 ? "" : pendingRaw;
      const beforeNonSgr = cells.length === 0 ? "" : pendingNonSgr;

      if (cells.length === 0) {
        prefix = pendingRaw;
        prefixNonSgr = pendingNonSgr;
      }

      cells.push({
        text: segment,
        width,
        before,
        beforeNonSgr,
        fgCode: style.fgCode,
        bgCode: style.bgCode,
        fg: colorCodeToRgb(style.fgCode),
        bg: colorCodeToRgb(style.bgCode),
        style,
        styleKey: styleStateKey(style),
        styleAnsi: styleStateToAnsi(style),
      });

      pendingRaw = "";
      pendingNonSgr = "";
    }

    index = nextEscape;
  }

  return {
    prefix,
    prefixNonSgr,
    cells,
    suffix: pendingRaw,
    suffixNonSgr: pendingNonSgr,
    visibleWidth: visibleWidth(line),
  };
};

export const syncAnsiCellStyleMetadata = (cell: AnsiCell) => {
  cell.fgCode = cell.style.fgCode;
  cell.bgCode = cell.style.bgCode;
  cell.fg = colorCodeToRgb(cell.style.fgCode);
  cell.bg = colorCodeToRgb(cell.style.bgCode);
  cell.styleKey = styleStateKey(cell.style);
  cell.styleAnsi = styleStateToAnsi(cell.style);
};

export const parseAnsiGrid = (lines: string[]): AnsiGrid => {
  return {
    lines: lines.map((line) => parseAnsiLine(line)),
  };
};
