import { AssistantMessageComponent, ToolExecutionComponent, UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { Markdown, visibleWidth } from "@mariozechner/pi-tui";

import {
  createRainbowMotion,
  DEFAULT_VIBRANCE,
  frameBucketToElapsedMs,
  getFrameBucket,
  getRainbowColor,
  offsetRainbowBackgroundColor,
  offsetRainbowColor,
  phaseAt,
  type RGB,
  type RainbowMotion,
} from "./motion.js";
import { DEFAULT_PRESET_ID } from "./presets.js";
import type { RainbowAnimationController } from "./runtime.js";
import type { RainbowSettingsStore } from "./settings.js";

type AssistantContent =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; redacted?: boolean }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> };

type AssistantMessageLike = {
  content: AssistantContent[];
  stopReason: string;
  errorMessage?: string;
  timestamp: number;
};

type MarkdownInternals = {
  defaultTextStyle?: unknown;
  paddingX: number;
  paddingY: number;
  text: string;
  theme: ConstructorParameters<typeof Markdown>[3];
  render(width: number): string[];
};

type AssistantMotionState = {
  phaseSeed: number;
  renderOrder?: number;
  cachedBaseLines?: string[];
  cachedFrame?: number;
  cachedKey?: string;
  cachedLines?: string[];
};

type ToolRenderState = {
  phaseSeed: number;
  renderOrder?: number;
  frozenFrame?: number;
  cachedBaseLines?: string[];
  cachedFrame?: number;
  cachedKey?: string;
  cachedLines?: string[];
};

type UserMessageInternals = {
  contentBox?: {
    children: unknown[];
  };
};

type PatchState = {
  getSettings: () => ReturnType<RainbowSettingsStore["get"]>;
  getElapsedMs: () => number;
  assistantOrderCounter: number;
  latestAssistantOrder: number;
  toolOrderCounter: number;
  latestToolOrder: number;
  installed: boolean;
  originalUpdateContent?: (this: AssistantMessageComponent, message: AssistantMessageLike) => void;
  originalAssistantRender?: (this: AssistantMessageComponent, width: number) => string[];
  originalToolRender?: (this: ToolExecutionComponent, width: number) => string[];
  originalUserRender?: (this: UserMessageComponent, width: number) => string[];
};

const RESET = "\x1b[0m";
const ANSI_SGR_RESET = /^\x1b\[(?:0(?:;0)*)?m$/;
const PATCH_STATE_KEY = Symbol.for("pi-plugin-rainbow.assistantPatchState");
const MOTION_STATE_KEY = Symbol.for("pi-plugin-rainbow.assistantMotionState");
const TOOL_RENDER_STATE_KEY = Symbol.for("pi-plugin-rainbow.toolRenderState");
const USER_RENDER_STATE_KEY = Symbol.for("pi-plugin-rainbow.userRenderState");
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const USER_BORDER_CHARS = /[╭╮╰╯│─]/u;
const DEFAULT_FG_ANSI = "\x1b[39m";
const LINE_PARSE_CACHE_LIMIT = 800;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const parsedLineCache = new Map<string, ParsedLine>();

const haveSameLines = (previous: string[] | undefined, next: string[]) => {
  return !!previous
    && previous.length === next.length
    && previous.every((line, index) => line === next[index]);
};

type UserRenderState = {
  phaseSeed: number;
  cachedKey?: string;
  cachedLines?: string[];
};

type ParsedLineToken =
  | {
      type: "ansi";
      value: string;
    }
  | {
      type: "text";
      value: string;
      width: number;
      explicitFg: RGB | null;
      restoreFgAnsi: string;
    };

type ParsedLine = {
  tokens: ParsedLineToken[];
};

const getPatchState = () => {
  const scopedGlobal = globalThis as typeof globalThis & {
    [PATCH_STATE_KEY]?: PatchState;
  };

  if (!scopedGlobal[PATCH_STATE_KEY]) {
    scopedGlobal[PATCH_STATE_KEY] = {
      getSettings: () => ({ enabled: true, fg: true, colorInput: false, colorToolBoxes: true, animateToolBoxes: true, showStatus: false, bg: false, preset: DEFAULT_PRESET_ID, speed: 0.008, turns: 3, vibrance: DEFAULT_VIBRANCE, glow: 0.05 }),
      getElapsedMs: () => 0,
      assistantOrderCounter: 0,
      latestAssistantOrder: 0,
      toolOrderCounter: 0,
      latestToolOrder: 0,
      installed: false,
    };
  }

  return scopedGlobal[PATCH_STATE_KEY]!;
};

const getMotionState = (component: object, message: AssistantMessageLike) => {
  const scopedComponent = component as typeof component & {
    [MOTION_STATE_KEY]?: AssistantMotionState;
  };

  if (!scopedComponent[MOTION_STATE_KEY]) {
    scopedComponent[MOTION_STATE_KEY] = {
      phaseSeed: ((message.timestamp % 997) + 997) / 997,
      cachedFrame: Number.NaN,
    };
  }

  return scopedComponent[MOTION_STATE_KEY]!;
};

const getToolRenderState = (component: object, seed: string) => {
  const scopedComponent = component as typeof component & {
    [TOOL_RENDER_STATE_KEY]?: ToolRenderState;
  };

  if (!scopedComponent[TOOL_RENDER_STATE_KEY]) {
    scopedComponent[TOOL_RENDER_STATE_KEY] = {
      phaseSeed: (hashString(seed) % 997) / 997,
      cachedFrame: Number.NaN,
    };
  }

  return scopedComponent[TOOL_RENDER_STATE_KEY]!;
};

export const getAssistantAnimationFrame = (
  motion: Pick<AssistantMotionState, "renderOrder">,
  latestAssistantOrder: number,
  speed: number,
  elapsedMs: number,
) => {
  const isLatest = motion.renderOrder !== undefined && motion.renderOrder === latestAssistantOrder;
  const animatedElapsedMs = speed > 0 && isLatest ? elapsedMs : 0;

  return {
    isLatest,
    elapsedMs: animatedElapsedMs,
    frame: speed > 0 && isLatest ? getFrameBucket(animatedElapsedMs) : 0,
  };
};

export const getToolAnimationFrame = (
  motion: Pick<ToolRenderState, "renderOrder" | "frozenFrame">,
  latestToolOrder: number,
  speed: number,
  elapsedMs: number,
  animateToolBoxes: boolean,
  isPending: boolean,
) => {
  const isLatest = motion.renderOrder !== undefined && motion.renderOrder === latestToolOrder;

  if (!animateToolBoxes || speed <= 0) {
    const frame = motion.frozenFrame ?? 0;
    return {
      isLatest,
      elapsedMs: 0,
      frame,
      nextFrozenFrame: frame,
    };
  }

  if (isPending && isLatest) {
    const frame = getFrameBucket(elapsedMs);
    return {
      isLatest,
      elapsedMs,
      frame,
      nextFrozenFrame: frame,
    };
  }

  const frame = motion.frozenFrame ?? 0;
  return {
    isLatest,
    elapsedMs: 0,
    frame,
    nextFrozenFrame: frame,
  };
};

const isMarkdownLike = (value: unknown): value is MarkdownInternals => {
  return typeof value === "object"
    && value !== null
    && typeof (value as { render?: unknown }).render === "function"
    && typeof (value as { text?: unknown }).text === "string"
    && typeof (value as { paddingX?: unknown }).paddingX === "number"
    && typeof (value as { paddingY?: unknown }).paddingY === "number"
    && "theme" in value;
};

const readEscapeSequence = (line: string, index: number) => {
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

  if (next === "]" || next === "_") {
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

const fgCode = (r: number, g: number, b: number) => {
  return `\x1b[38;2;${r};${g};${b}m`;
};

const bgCode = (r: number, g: number, b: number) => {
  return `\x1b[48;2;${r};${g};${b}m`;
};

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

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

const updateTrackedColorCode = (current: string | null, sequence: string, target: "fg" | "bg") => {
  if (!sequence.endsWith("m")) {
    return current;
  }

  const match = sequence.match(/\x1b\[([\d;]*)m/);
  if (!match) {
    return current;
  }

  const params = match[1] ?? "";
  if (params === "") {
    return null;
  }

  const parts = params.split(";");
  let next = current;
  const extendedCode = target === "fg" ? 38 : 48;
  const resetCode = target === "fg" ? 39 : 49;
  const basicStart = target === "fg" ? 30 : 40;
  const brightStart = target === "fg" ? 90 : 100;
  const brightEnd = brightStart + 7;

  for (let index = 0; index < parts.length; ) {
    const code = Number.parseInt(parts[index] ?? "", 10);
    if (Number.isNaN(code)) {
      index += 1;
      continue;
    }

    if (code === 0) {
      next = null;
      index += 1;
      continue;
    }

    if (code === extendedCode) {
      if (parts[index + 1] === "5" && parts[index + 2] !== undefined) {
        next = `${extendedCode};5;${parts[index + 2]}`;
        index += 3;
        continue;
      }

      if (parts[index + 1] === "2" && parts[index + 4] !== undefined) {
        next = `${extendedCode};2;${parts[index + 2]};${parts[index + 3]};${parts[index + 4]}`;
        index += 5;
        continue;
      }
    }

    if (code === 38 || code === 48) {
      if (parts[index + 1] === "5" && parts[index + 2] !== undefined) {
        index += 3;
        continue;
      }

      if (parts[index + 1] === "2" && parts[index + 4] !== undefined) {
        index += 5;
        continue;
      }
    }

    if (code === resetCode) {
      next = null;
      index += 1;
      continue;
    }

    if ((code >= basicStart && code <= basicStart + 7) || (code >= brightStart && code <= brightEnd)) {
      next = String(code);
    }

    index += 1;
  }

  return next;
};

export const updateForegroundColorCode = (current: string | null, sequence: string) => {
  return updateTrackedColorCode(current, sequence, "fg");
};

export const updateBackgroundColorCode = (current: string | null, sequence: string) => {
  return updateTrackedColorCode(current, sequence, "bg");
};

export const getParsedRainbowLine = (line: string): ParsedLine => {
  const cached = parsedLineCache.get(line);
  if (cached) {
    return cached;
  }

  const tokens: ParsedLineToken[] = [];
  let currentFgCode: string | null = null;
  let currentFgRgb: RGB | null = null;
  let currentRestoreFgAnsi = DEFAULT_FG_ANSI;

  for (let index = 0; index < line.length; ) {
    if (line.charCodeAt(index) === 0x1b) {
      const sequence = readEscapeSequence(line, index);
      if (sequence) {
        tokens.push({ type: "ansi", value: sequence });

        if (sequence.endsWith("m")) {
          currentFgCode = updateForegroundColorCode(currentFgCode, sequence);
          currentFgRgb = colorCodeToRgb(currentFgCode);
          currentRestoreFgAnsi = currentFgCode ? `\x1b[${currentFgCode}m` : DEFAULT_FG_ANSI;
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
      tokens.push({
        type: "text",
        value: segment,
        width: visibleWidth(segment),
        explicitFg: currentFgRgb,
        restoreFgAnsi: currentRestoreFgAnsi,
      });
    }

    index = nextEscape;
  }

  const parsedLine = { tokens };
  if (parsedLineCache.size >= LINE_PARSE_CACHE_LIMIT) {
    const firstKey = parsedLineCache.keys().next().value;
    if (typeof firstKey === "string") {
      parsedLineCache.delete(firstKey);
    }
  }

  parsedLineCache.set(line, parsedLine);
  return parsedLine;
};

const hashString = (value: string) => {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
};

const getUserRenderState = (component: object, seed: string) => {
  const scopedComponent = component as typeof component & {
    [USER_RENDER_STATE_KEY]?: UserRenderState;
  };

  if (!scopedComponent[USER_RENDER_STATE_KEY]) {
    scopedComponent[USER_RENDER_STATE_KEY] = {
      phaseSeed: (hashString(seed) % 997) / 997,
    };
  }

  return scopedComponent[USER_RENDER_STATE_KEY]!;
};

const colorizePlainTextLine = (
  line: string,
  row: number,
  motion: RainbowMotion,
  preset: string,
  vibrance: number,
) => {
  const parsedLine = getParsedRainbowLine(line);
  let result = "";
  let column = 0;
  let changed = false;

  for (const token of parsedLine.tokens) {
    if (token.type === "ansi") {
      result += token.value;
      continue;
    }

    if (token.width === 0 || token.value === " " || token.value === "\t") {
      result += token.value;
      column += token.width;
      continue;
    }

    const phase = phaseAt(motion, row, column);
    const color = token.explicitFg
      ? offsetRainbowColor(token.explicitFg, phase, preset, vibrance)
      : getRainbowColor(phase, preset, vibrance);
    result += `${fgCode(color.r, color.g, color.b)}${token.value}${token.restoreFgAnsi}`;
    changed = true;
    column += token.width;
  }

  return changed ? result : line;
};

const colorizeBorderOnlyLine = (
  line: string,
  row: number,
  motion: RainbowMotion,
  preset: string,
  vibrance: number,
) => {
  let activeAnsi = RESET;
  let result = "";
  let column = 0;
  let changed = false;

  for (let index = 0; index < line.length; ) {
    if (line.charCodeAt(index) === 0x1b) {
      const sequence = readEscapeSequence(line, index);
      if (sequence) {
        result += sequence;

        if (sequence.endsWith("m")) {
          activeAnsi = ANSI_SGR_RESET.test(sequence)
            ? RESET
            : activeAnsi === RESET
              ? sequence
              : `${activeAnsi}${sequence}`;
        }

        index += sequence.length;
        continue;
      }
    }

    const codePoint = line.codePointAt(index);
    if (codePoint === undefined) break;

    const char = String.fromCodePoint(codePoint);
    const charWidth = visibleWidth(char);
    if (charWidth === 0) {
      result += char;
      index += char.length;
      continue;
    }

    if (USER_BORDER_CHARS.test(char)) {
      const phase = phaseAt(motion, row, column);
      const fg = getRainbowColor(phase, preset, vibrance);
      result += `${fgCode(fg.r, fg.g, fg.b)}${char}${activeAnsi}`;
      changed = true;
    } else {
      result += char;
    }

    column += charWidth;
    index += char.length;
  }

  return changed ? `${result}${RESET}` : line;
};

export const colorizeToolBoxLine = (
  line: string,
  row: number,
  motion: RainbowMotion,
  preset: string,
  vibrance: number,
) => {
  let activeAnsi = RESET;
  let currentBgCode: string | null = null;
  let currentBgRgb: RGB | null = null;
  let result = "";
  let column = 0;
  let changed = false;

  for (let index = 0; index < line.length; ) {
    if (line.charCodeAt(index) === 0x1b) {
      const sequence = readEscapeSequence(line, index);
      if (sequence) {
        result += sequence;

        if (sequence.endsWith("m")) {
          activeAnsi = ANSI_SGR_RESET.test(sequence)
            ? RESET
            : activeAnsi === RESET
              ? sequence
              : `${activeAnsi}${sequence}`;
          currentBgCode = updateBackgroundColorCode(currentBgCode, sequence);
          currentBgRgb = colorCodeToRgb(currentBgCode);
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
        result += segment;
        continue;
      }

      if (!currentBgRgb) {
        result += segment;
        column += width;
        continue;
      }

      const phase = phaseAt(motion, row, column);
      const bg = offsetRainbowBackgroundColor(currentBgRgb, phase, preset, vibrance);
      result += `${bgCode(bg.r, bg.g, bg.b)}${segment}${activeAnsi}`;
      changed = true;
      column += width;
    }

    index = nextEscape;
  }

  return changed ? `${result}${RESET}` : line;
};

const withOscMarkers = (lines: string[]) => {
  if (lines.length === 0) {
    return lines;
  }

  const next = [...lines];
  next[0] = OSC133_ZONE_START + next[0];
  next[next.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + next[next.length - 1];
  return next;
};

const renderRainbowPromptOutline = (
  markdown: MarkdownInternals,
  width: number,
  frame: number,
  phaseSeed: number,
  speed: number,
  turns: number,
  preset: string,
  vibrance: number,
) => {
  if (width < 4) {
    return withOscMarkers(markdown.render(Math.max(1, width)));
  }

  const horizontalWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, width - 4);
  const contentLines = markdown.render(contentWidth);
  const emptyContent = " ".repeat(contentWidth);
  const surfaceHeight = contentLines.length + 4;
  const motion = createRainbowMotion(width, surfaceHeight, turns, frameBucketToElapsedMs(frame), speed, phaseSeed);
  const lines = [
    `╭${"─".repeat(horizontalWidth)}╮`,
    `│ ${emptyContent} │`,
    ...contentLines.map((line) => `│ ${line} │`),
    `│ ${emptyContent} │`,
    `╰${"─".repeat(horizontalWidth)}╯`,
  ].map((line, row) => colorizeBorderOnlyLine(line, row, motion, preset, vibrance));

  return withOscMarkers(lines);
};

export const installAssistantMessagePatch = (
  store: RainbowSettingsStore,
  animation: RainbowAnimationController,
) => {
  const patchState = getPatchState();
  patchState.getSettings = () => store.get();
  patchState.getElapsedMs = () => animation.getElapsedMs();

  if (patchState.installed) {
    return;
  }

  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent as PatchState["originalUpdateContent"];
  if (!originalUpdateContent) {
    throw new Error("AssistantMessageComponent.updateContent is unavailable");
  }

  const originalAssistantRender = AssistantMessageComponent.prototype.render as PatchState["originalAssistantRender"];
  if (!originalAssistantRender) {
    throw new Error("AssistantMessageComponent.render is unavailable");
  }

  const originalToolRender = ToolExecutionComponent.prototype.render as PatchState["originalToolRender"];
  if (!originalToolRender) {
    throw new Error("ToolExecutionComponent.render is unavailable");
  }

  const originalUserRender = UserMessageComponent.prototype.render as PatchState["originalUserRender"];
  if (!originalUserRender) {
    throw new Error("UserMessageComponent.render is unavailable");
  }

  patchState.originalUpdateContent = originalUpdateContent;
  patchState.originalAssistantRender = originalAssistantRender;
  patchState.originalToolRender = originalToolRender;
  patchState.originalUserRender = originalUserRender;

  AssistantMessageComponent.prototype.updateContent = function patchedUpdateContent(message: AssistantMessageLike) {
    originalUpdateContent.call(this, message);
    const motion = getMotionState(this, message);
    if (motion.renderOrder === undefined) {
      motion.renderOrder = ++patchState.assistantOrderCounter;
    }
    if (motion.renderOrder > patchState.latestAssistantOrder) {
      patchState.latestAssistantOrder = motion.renderOrder;
    }
    motion.cachedBaseLines = undefined;
    motion.cachedFrame = Number.NaN;
    motion.cachedKey = undefined;
    motion.cachedLines = undefined;
  };

  AssistantMessageComponent.prototype.render = function patchedAssistantRender(width: number) {
    const settings = patchState.getSettings();
    const baseLines = originalAssistantRender.call(this, width);

    if (!settings.enabled || !settings.fg) {
      return baseLines;
    }

    const motion = (this as typeof this & { [MOTION_STATE_KEY]?: AssistantMotionState })[MOTION_STATE_KEY];
    if (!motion) {
      return baseLines;
    }

    const animation = getAssistantAnimationFrame(
      motion,
      patchState.latestAssistantOrder,
      settings.speed,
      getPatchState().getElapsedMs(),
    );
    const frame = animation.frame;
    const key = `${settings.preset}:${settings.turns}:${settings.speed}:${settings.vibrance}:${motion.phaseSeed}:${motion.renderOrder === patchState.latestAssistantOrder ? 1 : 0}:${frame}:${width}`;

    if (motion.cachedLines && haveSameLines(motion.cachedBaseLines, baseLines) && motion.cachedFrame === frame && motion.cachedKey === key) {
      return motion.cachedLines;
    }

    const rainbowMotion = createRainbowMotion(
      width,
      baseLines.length,
      settings.turns,
      frameBucketToElapsedMs(animation.frame),
      settings.speed,
      motion.phaseSeed,
    );
    const lines = baseLines.map((line, row) => colorizePlainTextLine(line, row, rainbowMotion, settings.preset, settings.vibrance));

    motion.cachedBaseLines = [...baseLines];
    motion.cachedFrame = frame;
    motion.cachedKey = key;
    motion.cachedLines = lines;
    return lines;
  };

  ToolExecutionComponent.prototype.render = function patchedToolRender(width: number) {
    const settings = patchState.getSettings();
    const baseLines = originalToolRender.call(this, width);

    if (!settings.enabled || !settings.fg || !settings.colorToolBoxes || baseLines.length === 0) {
      return baseLines;
    }

    const component = this as unknown as { toolCallId?: string; toolName?: string; isPartial?: boolean };
    const seed = component.toolCallId ?? component.toolName ?? `tool:${width}`;
    const renderState = getToolRenderState(this, seed);
    const isPending = component.isPartial !== false;

    if (renderState.renderOrder === undefined) {
      renderState.renderOrder = ++patchState.toolOrderCounter;
    }
    if (renderState.renderOrder > patchState.latestToolOrder) {
      patchState.latestToolOrder = renderState.renderOrder;
    }

    const animation = getToolAnimationFrame(
      renderState,
      patchState.latestToolOrder,
      settings.speed,
      getPatchState().getElapsedMs(),
      settings.animateToolBoxes,
      isPending,
    );
    renderState.frozenFrame = animation.nextFrozenFrame;
    const frame = animation.frame;
    const key = `${settings.preset}:${settings.turns}:${settings.speed}:${settings.vibrance}:${settings.animateToolBoxes ? 1 : 0}:${isPending ? 1 : 0}:${renderState.phaseSeed}:${renderState.renderOrder === patchState.latestToolOrder ? 1 : 0}:${frame}:${width}`;

    if (renderState.cachedLines && haveSameLines(renderState.cachedBaseLines, baseLines) && renderState.cachedFrame === frame && renderState.cachedKey === key) {
      return renderState.cachedLines;
    }

    const rainbowMotion = createRainbowMotion(
      width,
      baseLines.length,
      settings.turns,
      frameBucketToElapsedMs(animation.frame),
      settings.speed,
      renderState.phaseSeed,
    );
    const lines = baseLines.map((line, row) => colorizeToolBoxLine(line, row, rainbowMotion, settings.preset, settings.vibrance));

    renderState.cachedBaseLines = [...baseLines];
    renderState.cachedFrame = frame;
    renderState.cachedKey = key;
    renderState.cachedLines = lines;
    return lines;
  };

  UserMessageComponent.prototype.render = function patchedUserRender(width: number) {
    const settings = patchState.getSettings();

    if (!settings.enabled || !settings.fg) {
      return originalUserRender.call(this, width);
    }

    const component = this as unknown as UserMessageInternals;
    const markdown = component.contentBox?.children.find((child) => isMarkdownLike(child));

    if (!isMarkdownLike(markdown)) {
      return originalUserRender.call(this, width);
    }

    const signature = `${width}\n${markdown.text}`;
    const renderState = getUserRenderState(this, signature);
    const frame = settings.speed > 0 ? getFrameBucket(getPatchState().getElapsedMs()) : 0;
    const key = `${settings.preset}:${settings.turns}:${settings.speed}:${settings.vibrance}:${frame}:${signature}`;

    if (renderState.cachedLines && renderState.cachedKey === key) {
      return renderState.cachedLines;
    }

    const lines = renderRainbowPromptOutline(
      markdown,
      width,
      frame,
      renderState.phaseSeed,
      settings.speed,
      settings.turns,
      settings.preset,
      settings.vibrance,
    );
    renderState.cachedKey = key;
    renderState.cachedLines = lines;
    return lines;
  };

  patchState.installed = true;
};
