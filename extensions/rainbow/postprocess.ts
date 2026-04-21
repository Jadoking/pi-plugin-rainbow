import { emitAnsiLineCompact } from "./ansi-emit.js";
import {
  parseAnsiLine,
  syncAnsiCellStyleMetadata,
  type AnsiCell,
  type AnsiGridLine,
  type RGB,
} from "./ansi-grid.js";
import {
  createRainbowMotion,
  getRainbowColor,
  offsetRainbowBackgroundColor,
  phaseAt,
} from "./motion.js";
import type { RainbowAnimationController } from "./runtime.js";
import type { RainbowSettings, RainbowSettingsStore } from "./settings.js";
import { getEffectiveAnimationSpeed, isTmuxFriendlyRendering } from "./terminal.js";

type RainbowFramePostprocessEnv = Partial<Pick<
  NodeJS.ProcessEnv,
  "PI_RAINBOW_POSTPROCESS_RAINBOW" | "TMUX" | "PI_RAINBOW_FORCE_ANIMATION" | "PI_RAINBOW_DISABLE_ANIMATION"
>>;

type RainbowFramePostprocessContext = {
  renderIndex: number;
  width: number;
  height: number;
  previousLines?: string[];
};

type ThemeLike = {
  fg: (token: any, text: string) => string;
  bg: (token: any, text: string) => string;
};

type RainbowFrameCache = {
  previousSourceLines?: string[];
  previousOutputLines?: string[];
  renderSignature?: string;
  activeMarkedRows?: number[];
  activeMarkedUntilMs?: number;
};

type RainbowFrameRuntime = {
  getSettings: () => RainbowSettings;
  getElapsedMs: () => number;
  getTheme: () => ThemeLike | undefined;
  getEnv?: () => RainbowFramePostprocessEnv;
  getNowMs?: () => number;
  cache?: RainbowFrameCache;
};

type ThemeProfile = {
  signature: string;
  neutralFgKeys: Set<string>;
  toolBgKeys: Set<string>;
};

const SAMPLE_TEXT = "X";
const FG_TOKENS = ["text", "muted", "dim", "border", "borderMuted", "userMessageText"] as const;
const TOOL_BG_TOKENS = ["toolPendingBg", "toolSuccessBg", "toolErrorBg"] as const;
const TMUX_MARKED_BLOCK_SETTLE_MS = 420;
const TMUX_MARKED_BLOCK_MAX_LIVE_ROWS = 1;
const TMUX_DISABLE_FOREGROUND_ANIMATION = true;
const DISABLE_TOOL_BOX_OVERRIDES = true;
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";
let runtime: RainbowFrameRuntime | undefined;
let cachedThemeProfile: ThemeProfile | undefined;

const isTruthyFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const colorKey = (color: RGB | null) => {
  return color ? `${color.r},${color.g},${color.b}` : undefined;
};

const sampleFg = (theme: ThemeLike, token: string) => {
  const parsed = parseAnsiLine(theme.fg(token, SAMPLE_TEXT));
  return parsed.cells[0]?.fg ?? null;
};

const sampleBg = (theme: ThemeLike, token: string) => {
  const parsed = parseAnsiLine(theme.bg(token, SAMPLE_TEXT));
  return parsed.cells[0]?.bg ?? null;
};

const buildThemeSignature = (theme: ThemeLike) => {
  const fgSignature = FG_TOKENS.map((token) => theme.fg(token, SAMPLE_TEXT)).join("|");
  const bgSignature = TOOL_BG_TOKENS.map((token) => theme.bg(token, SAMPLE_TEXT)).join("|");
  return `${fgSignature}::${bgSignature}`;
};

const getThemeProfile = (theme: ThemeLike): ThemeProfile => {
  const signature = buildThemeSignature(theme);
  if (cachedThemeProfile?.signature === signature) {
    return cachedThemeProfile;
  }

  const neutralFgKeys = new Set<string>();
  const toolBgKeys = new Set<string>();

  for (const token of FG_TOKENS) {
    const key = colorKey(sampleFg(theme, token));
    if (key) neutralFgKeys.add(key);
  }

  for (const token of TOOL_BG_TOKENS) {
    const key = colorKey(sampleBg(theme, token));
    if (key) toolBgKeys.add(key);
  }

  cachedThemeProfile = {
    signature,
    neutralFgKeys,
    toolBgKeys,
  };
  return cachedThemeProfile;
};

const isWhitespaceOnly = (text: string) => {
  return /^\s+$/u.test(text);
};

const setCellFg = (cell: AnsiCell, color: RGB) => {
  cell.style.fgCode = `38;2;${color.r};${color.g};${color.b}`;
  syncAnsiCellStyleMetadata(cell);
};

const setCellBg = (cell: AnsiCell, color: RGB) => {
  cell.style.bgCode = `48;2;${color.r};${color.g};${color.b}`;
  syncAnsiCellStyleMetadata(cell);
};

const shouldColorForeground = (cell: AnsiCell, settings: RainbowSettings, profile: ThemeProfile) => {
  if (!settings.enabled || !settings.fg || isWhitespaceOnly(cell.text)) {
    return false;
  }

  const key = colorKey(cell.fg);
  return key === undefined || profile.neutralFgKeys.has(key);
};

const shouldTintToolBackground = (cell: AnsiCell, settings: RainbowSettings, profile: ThemeProfile) => {
  if (DISABLE_TOOL_BOX_OVERRIDES || !settings.enabled || !settings.colorToolBoxes || !cell.bg) {
    return false;
  }

  const key = colorKey(cell.bg);
  return !!key && profile.toolBgKeys.has(key);
};

const isToolBackgroundLine = (line: string, profile: ThemeProfile) => {
  const parsed = parseAnsiLine(line);
  return parsed.cells.some((cell) => {
    const key = colorKey(cell.bg);
    return !!key && profile.toolBgKeys.has(key);
  });
};

const collectChangedRows = (previous: string[] | undefined, next: string[]) => {
  const rows = new Set<number>();
  if (!previous) {
    return rows;
  }

  const limit = Math.max(previous.length, next.length);
  for (let row = 0; row < limit; row += 1) {
    if ((previous[row] ?? "") !== (next[row] ?? "")) {
      rows.add(row);
    }
  }

  return rows;
};

const rowsFromRange = (start: number, end: number) => {
  const rows = new Set<number>();
  for (let row = start; row <= end; row += 1) {
    rows.add(row);
  }
  return rows;
};

const getOsc133MarkedBlocks = (lines: string[]) => {
  const blocks: Array<{ start: number; end: number }> = [];
  let start: number | undefined;

  for (let row = 0; row < lines.length; row += 1) {
    const line = lines[row]!;
    if (line.includes(OSC133_ZONE_START)) {
      start = row;
    }

    if (start !== undefined && (line.includes(OSC133_ZONE_END) || line.includes(OSC133_ZONE_FINAL))) {
      blocks.push({ start, end: row });
      start = undefined;
    }
  }

  if (start !== undefined) {
    blocks.push({ start, end: lines.length - 1 });
  }

  return blocks;
};

const getLatestChangedMarkedBlockRows = (lines: string[], changedRows: Set<number>) => {
  const blocks = getOsc133MarkedBlocks(lines);

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index]!;
    for (let row = block.start; row <= block.end; row += 1) {
      if (changedRows.has(row)) {
        const tailStart = Math.max(block.start, block.end - TMUX_MARKED_BLOCK_MAX_LIVE_ROWS + 1);
        return rowsFromRange(tailStart, block.end);
      }
    }
  }

  return new Set<number>();
};

const getLatestToolBlockRows = (lines: string[], settings: RainbowSettings, profile: ThemeProfile) => {
  if (DISABLE_TOOL_BOX_OVERRIDES || !settings.colorToolBoxes || !settings.animateToolBoxes) {
    return new Set<number>();
  }

  const toolRows: number[] = [];
  for (let row = 0; row < lines.length; row += 1) {
    if (isToolBackgroundLine(lines[row]!, profile)) {
      toolRows.push(row);
    }
  }

  if (toolRows.length === 0) {
    return new Set<number>();
  }

  let startIndex = toolRows.length - 1;
  while (startIndex > 0 && toolRows[startIndex - 1] === toolRows[startIndex]! - 1) {
    startIndex -= 1;
  }

  return new Set(toolRows.slice(startIndex));
};

const buildRenderSignature = (
  settings: RainbowSettings,
  profile: ThemeProfile,
  width: number,
  effectiveSpeed: number,
  useTmuxLiveRegions: boolean,
) => {
  return [
    profile.signature,
    width,
    settings.enabled ? 1 : 0,
    settings.fg ? 1 : 0,
    settings.colorToolBoxes ? 1 : 0,
    settings.animateToolBoxes ? 1 : 0,
    settings.animateInTmux ? 1 : 0,
    settings.preset,
    settings.turns,
    settings.vibrance,
    effectiveSpeed,
    useTmuxLiveRegions ? 1 : 0,
  ].join("|");
};

type TmuxRenderPlan = {
  resetAllRows: boolean;
  renderRows: Set<number>;
  animateMarkedRows: Set<number>;
  animateToolRows: Set<number>;
};

const getTmuxRenderPlan = (
  lines: string[],
  settings: RainbowSettings,
  profile: ThemeProfile,
  cache: RainbowFrameCache,
  renderSignature: string,
  nowMs: number,
  animateForegroundInTmux: boolean,
): TmuxRenderPlan => {
  const resetAllRows = !cache.previousOutputLines
    || cache.previousOutputLines.length !== lines.length
    || cache.renderSignature !== renderSignature;
  const changedRows = resetAllRows
    ? new Set(lines.map((_, row) => row))
    : collectChangedRows(cache.previousSourceLines, lines);
  const renderRows = resetAllRows
    ? new Set(lines.map((_, row) => row))
    : new Set(changedRows);
  const animateMarkedRows = new Set<number>();
  const animateToolRows = new Set<number>();

  if (animateForegroundInTmux) {
    const markedRows = getLatestChangedMarkedBlockRows(lines, changedRows);
    if (markedRows.size > 0) {
      cache.activeMarkedRows = [...markedRows];
      cache.activeMarkedUntilMs = nowMs + TMUX_MARKED_BLOCK_SETTLE_MS;
    } else if (resetAllRows || (cache.activeMarkedUntilMs ?? 0) <= nowMs) {
      cache.activeMarkedRows = undefined;
      cache.activeMarkedUntilMs = undefined;
    }

    if ((cache.activeMarkedUntilMs ?? 0) > nowMs) {
      for (const row of cache.activeMarkedRows ?? []) {
        if (row >= 0 && row < lines.length) {
          animateMarkedRows.add(row);
          renderRows.add(row);
        }
      }
    }
  } else {
    cache.activeMarkedRows = undefined;
    cache.activeMarkedUntilMs = undefined;
  }

  const toolRows = getLatestToolBlockRows(lines, settings, profile);
  for (const row of toolRows) {
    animateToolRows.add(row);
    renderRows.add(row);
  }

  return {
    resetAllRows,
    renderRows,
    animateMarkedRows,
    animateToolRows,
  };
};

type RainbowLineRenderOptions = {
  frozenForegroundMotion?: ReturnType<typeof createRainbowMotion>;
  foregroundAnimatedTailColumns?: number;
  foregroundPhaseColumnStep?: number;
};

const applyRainbowToParsedLine = (
  line: AnsiGridLine,
  row: number,
  settings: RainbowSettings,
  profile: ThemeProfile,
  foregroundMotion: ReturnType<typeof createRainbowMotion>,
  toolMotion: ReturnType<typeof createRainbowMotion>,
  options?: RainbowLineRenderOptions,
) => {
  const frozenForegroundMotion = options?.frozenForegroundMotion ?? foregroundMotion;
  const phaseColumnStep = Math.max(1, options?.foregroundPhaseColumnStep ?? 1);
  const totalWidth = line.cells.reduce((sum, cell) => sum + Math.max(0, cell.width), 0);
  const foregroundAnimatedFromColumn = options?.foregroundAnimatedTailColumns === undefined
    ? undefined
    : Math.max(0, totalWidth - options.foregroundAnimatedTailColumns);
  let column = 0;

  for (const cell of line.cells) {
    if (cell.width <= 0) {
      continue;
    }

    const phaseColumn = phaseColumnStep > 1 ? Math.floor(column / phaseColumnStep) * phaseColumnStep : column;
    const useAnimatedForeground = foregroundAnimatedFromColumn === undefined || column >= foregroundAnimatedFromColumn;
    const fgPhase = phaseAt(useAnimatedForeground ? foregroundMotion : frozenForegroundMotion, row, phaseColumn);
    if (shouldColorForeground(cell, settings, profile)) {
      setCellFg(cell, getRainbowColor(fgPhase, settings.preset, settings.vibrance));
    }

    if (shouldTintToolBackground(cell, settings, profile) && cell.bg) {
      const bgPhase = phaseAt(toolMotion, row, column);
      setCellBg(cell, offsetRainbowBackgroundColor(cell.bg, bgPhase, settings.preset, settings.vibrance));
    }

    column += cell.width;
  }

  return emitAnsiLineCompact(line);
};

const renderRainbowLine = (
  line: string,
  row: number,
  settings: RainbowSettings,
  profile: ThemeProfile,
  foregroundMotion: ReturnType<typeof createRainbowMotion>,
  toolMotion: ReturnType<typeof createRainbowMotion>,
  options?: RainbowLineRenderOptions,
) => {
  return applyRainbowToParsedLine(parseAnsiLine(line), row, settings, profile, foregroundMotion, toolMotion, options);
};

export const isRainbowFramePostprocessEnabled = (env: RainbowFramePostprocessEnv = process.env) => {
  const flag = env.PI_RAINBOW_POSTPROCESS_RAINBOW;
  if (flag === undefined) {
    return true;
  }

  return isTruthyFlag(flag);
};

export const configureRainbowFramePostprocess = (
  store: RainbowSettingsStore,
  animation: RainbowAnimationController,
  getTheme: () => ThemeLike | undefined,
) => {
  runtime = {
    getSettings: () => store.get(),
    getElapsedMs: () => animation.getElapsedMs(),
    getTheme,
    getEnv: () => process.env,
    getNowMs: () => Date.now(),
    cache: {},
  };
};

export const applyRainbowFramePostprocess = (
  lines: string[],
  context: RainbowFramePostprocessContext,
  activeRuntime = runtime,
) => {
  if (!activeRuntime) {
    return lines;
  }

  const settings = activeRuntime.getSettings();
  const theme = activeRuntime.getTheme();
  if (!theme || !settings.enabled || (!settings.fg && !settings.colorToolBoxes)) {
    return lines;
  }

  const env = activeRuntime.getEnv?.();
  const profile = getThemeProfile(theme);
  const effectiveSpeed = getEffectiveAnimationSpeed(settings.speed, settings, env);
  const elapsedMs = effectiveSpeed > 0 ? activeRuntime.getElapsedMs() : 0;
  const toolElapsedMs = effectiveSpeed > 0 && settings.animateToolBoxes ? elapsedMs : 0;
  const cache = activeRuntime.cache ?? {};
  const useTmuxLiveRegions = isTmuxFriendlyRendering(env) && effectiveSpeed > 0;
  const animateForegroundInTmux = !TMUX_DISABLE_FOREGROUND_ANIMATION;
  const renderSignature = buildRenderSignature(settings, profile, context.width, effectiveSpeed, useTmuxLiveRegions);
  const nowMs = activeRuntime.getNowMs?.() ?? Date.now();
  const foregroundMotion = createRainbowMotion(context.width, Math.max(1, lines.length), settings.turns, elapsedMs, effectiveSpeed);
  const toolMotion = createRainbowMotion(context.width, Math.max(1, lines.length), settings.turns, toolElapsedMs, effectiveSpeed);
  const frozenForegroundMotion = createRainbowMotion(context.width, Math.max(1, lines.length), settings.turns, 0, 0);
  const frozenToolMotion = createRainbowMotion(context.width, Math.max(1, lines.length), settings.turns, 0, 0);

  const nextLines = useTmuxLiveRegions
    ? (() => {
      const plan = getTmuxRenderPlan(lines, settings, profile, cache, renderSignature, nowMs, animateForegroundInTmux);
      return lines.map((line, row) => {
        if (
          !plan.resetAllRows
          && !plan.renderRows.has(row)
          && cache.previousSourceLines?.[row] === line
          && cache.previousOutputLines?.[row] !== undefined
        ) {
          return cache.previousOutputLines[row]!;
        }

        const markedRowAnimated = plan.animateMarkedRows.has(row);
        const toolRowAnimated = plan.animateToolRows.has(row);
        const foregroundRowAnimated = animateForegroundInTmux && (markedRowAnimated || toolRowAnimated);

        return renderRainbowLine(
          line,
          row,
          settings,
          profile,
          foregroundRowAnimated ? foregroundMotion : frozenForegroundMotion,
          toolRowAnimated ? toolMotion : frozenToolMotion,
        );
      });
    })()
    : lines.map((line, row) => renderRainbowLine(line, row, settings, profile, foregroundMotion, toolMotion));

  cache.previousSourceLines = [...lines];
  cache.previousOutputLines = [...nextLines];
  cache.renderSignature = renderSignature;
  activeRuntime.cache = cache;
  return nextLines;
};
