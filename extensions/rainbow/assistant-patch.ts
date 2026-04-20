import { AssistantMessageComponent, UserMessageComponent } from "@mariozechner/pi-coding-agent";
import { Markdown, visibleWidth } from "@mariozechner/pi-tui";

import {
  createRainbowMotion,
  DEFAULT_VIBRANCE,
  frameBucketToElapsedMs,
  getFrameBucket,
  getRainbowColor,
  offsetRainbowColor,
  phaseAt,
  type RGB,
  type RainbowMotion,
} from "./motion.js";
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

type AssistantContentContainer = {
  children: unknown[];
};

type AssistantComponentInternals = {
  contentContainer: AssistantContentContainer;
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
};

type UserMessageInternals = {
  contentBox?: {
    children: unknown[];
  };
};

type PatchState = {
  getSettings: () => ReturnType<RainbowSettingsStore["get"]>;
  installed: boolean;
  originalUpdateContent?: (this: AssistantMessageComponent, message: AssistantMessageLike) => void;
  originalUserRender?: (this: UserMessageComponent, width: number) => string[];
};

const RESET = "\x1b[0m";
const ANSI_SGR_RESET = /^\x1b\[(?:0(?:;0)*)?m$/;
const PATCH_STATE_KEY = Symbol.for("pi-plugin-rainbow.assistantPatchState");
const MOTION_STATE_KEY = Symbol.for("pi-plugin-rainbow.assistantMotionState");
const USER_RENDER_STATE_KEY = Symbol.for("pi-plugin-rainbow.userRenderState");
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
const USER_BORDER_CHARS = /[╭╮╰╯│─]/u;
const DEFAULT_FG_ANSI = "\x1b[39m";
const LINE_PARSE_CACHE_LIMIT = 800;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const parsedLineCache = new Map<string, ParsedLine>();

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
      getSettings: () => ({ enabled: true, fg: true, showStatus: false, bg: false, speed: 0.008, turns: 3, vibrance: DEFAULT_VIBRANCE, glow: 0.05 }),
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
    };
  }

  return scopedComponent[MOTION_STATE_KEY]!;
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

  if (colorCode.startsWith("38;2;")) {
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

  if (colorCode.startsWith("38;5;")) {
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

  return null;
};

export const updateForegroundColorCode = (current: string | null, sequence: string) => {
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

    if (code === 38) {
      if (parts[index + 1] === "5" && parts[index + 2] !== undefined) {
        next = `38;5;${parts[index + 2]}`;
        index += 3;
        continue;
      }

      if (parts[index + 1] === "2" && parts[index + 4] !== undefined) {
        next = `38;2;${parts[index + 2]};${parts[index + 3]};${parts[index + 4]}`;
        index += 5;
        continue;
      }
    }

    if (code === 48) {
      if (parts[index + 1] === "5" && parts[index + 2] !== undefined) {
        index += 3;
        continue;
      }

      if (parts[index + 1] === "2" && parts[index + 4] !== undefined) {
        index += 5;
        continue;
      }
    }

    if (code === 39) {
      next = null;
      index += 1;
      continue;
    }

    if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
      next = String(code);
    }

    index += 1;
  }

  return next;
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

const colorizePlainTextLine = (line: string, row: number, motion: RainbowMotion, vibrance: number) => {
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
    const color = token.explicitFg ? offsetRainbowColor(token.explicitFg, phase, vibrance) : getRainbowColor(phase, vibrance);
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
      const fg = getRainbowColor(phase, vibrance);
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
  ].map((line, row) => colorizeBorderOnlyLine(line, row, motion, vibrance));

  return withOscMarkers(lines);
};

class RainbowAssistantMarkdown extends Markdown {
  private rainbowCachedBaseLines?: string[];
  private rainbowCachedFrame = Number.NaN;
  private rainbowCachedKey?: string;
  private rainbowCachedLines?: string[];

  constructor(
    text: string,
    paddingX: number,
    paddingY: number,
    theme: ConstructorParameters<typeof Markdown>[3],
    private readonly motion: AssistantMotionState,
  ) {
    super(text, paddingX, paddingY, theme);
  }

  override invalidate() {
    super.invalidate();
    this.rainbowCachedBaseLines = undefined;
    this.rainbowCachedFrame = Number.NaN;
    this.rainbowCachedKey = undefined;
    this.rainbowCachedLines = undefined;
  }

  override render(width: number) {
    const baseLines = super.render(width);
    const settings = getPatchState().getSettings();

    if (!settings.enabled || !settings.fg) {
      this.rainbowCachedBaseLines = baseLines;
      this.rainbowCachedFrame = Number.NaN;
      this.rainbowCachedKey = undefined;
      this.rainbowCachedLines = undefined;
      return baseLines;
    }

    const frame = getFrameBucket(Date.now());
    const key = `${settings.turns}:${settings.speed}:${settings.vibrance}:${this.motion.phaseSeed}:${frame}`;

    if (
      this.rainbowCachedLines &&
      this.rainbowCachedBaseLines === baseLines &&
      this.rainbowCachedFrame === frame &&
      this.rainbowCachedKey === key
    ) {
      return this.rainbowCachedLines;
    }

    const motion = createRainbowMotion(width, baseLines.length, settings.turns, frameBucketToElapsedMs(frame), settings.speed, this.motion.phaseSeed);
    const lines = baseLines.map((line, row) => colorizePlainTextLine(line, row, motion, settings.vibrance));

    this.rainbowCachedBaseLines = baseLines;
    this.rainbowCachedFrame = frame;
    this.rainbowCachedKey = key;
    this.rainbowCachedLines = lines;
    return lines;
  }
}

export const installAssistantMessagePatch = (store: RainbowSettingsStore) => {
  const patchState = getPatchState();
  patchState.getSettings = () => store.get();

  if (patchState.installed) {
    return;
  }

  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent as PatchState["originalUpdateContent"];
  if (!originalUpdateContent) {
    throw new Error("AssistantMessageComponent.updateContent is unavailable");
  }

  const originalUserRender = UserMessageComponent.prototype.render as PatchState["originalUserRender"];
  if (!originalUserRender) {
    throw new Error("UserMessageComponent.render is unavailable");
  }

  patchState.originalUpdateContent = originalUpdateContent;
  patchState.originalUserRender = originalUserRender;

  AssistantMessageComponent.prototype.updateContent = function patchedUpdateContent(message: AssistantMessageLike) {
    originalUpdateContent.call(this, message);

    const component = this as unknown as AssistantComponentInternals;
    const contentContainer = component.contentContainer;
    if (!contentContainer) {
      return;
    }

    const motion = getMotionState(this, message);

    for (let index = 0; index < contentContainer.children.length; index += 1) {
      const child = contentContainer.children[index];
      if (!isMarkdownLike(child) || child instanceof RainbowAssistantMarkdown) {
        continue;
      }

      const markdownChild = child;

      if (markdownChild.defaultTextStyle !== undefined) {
        continue;
      }

      contentContainer.children[index] = new RainbowAssistantMarkdown(
        markdownChild.text,
        markdownChild.paddingX,
        markdownChild.paddingY,
        markdownChild.theme,
        motion,
      );
    }
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
    const frame = getFrameBucket(Date.now());
    const key = `${settings.turns}:${settings.speed}:${settings.vibrance}:${frame}:${signature}`;

    if (renderState.cachedLines && renderState.cachedKey === key) {
      return renderState.cachedLines;
    }

    const lines = renderRainbowPromptOutline(markdown, width, frame, renderState.phaseSeed, settings.speed, settings.turns, settings.vibrance);
    renderState.cachedKey = key;
    renderState.cachedLines = lines;
    return lines;
  };

  patchState.installed = true;
};
