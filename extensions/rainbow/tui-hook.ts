import { ProcessTerminal, TUI } from "@mariozechner/pi-tui";

import { emitAnsiGrid, emitAnsiGridCompact } from "./ansi-emit.js";
import { parseAnsiGrid } from "./ansi-grid.js";
import { applyRainbowFramePostprocess, isRainbowFramePostprocessEnabled } from "./postprocess.js";
import {
  countChangedLines,
  isRainbowPostprocessCompactEnabled,
  isRainbowPostprocessProbeEnabled,
  isRainbowPostprocessRoundtripEnabled,
  isRainbowPostprocessSpikeEnabled,
  isRainbowRenderDebugEnabled,
  logRainbowDebugEvent,
} from "./render-debug.js";

type TuiPostprocessContext = {
  renderIndex: number;
  width: number;
  height: number;
  previousLines?: string[];
};

type TuiPostprocessFn = (lines: string[], context: TuiPostprocessContext) => string[];

type FrameMetrics = {
  renderIndex: number;
  startedAtMs: number;
  requestCalls: number;
  bytesWritten: number;
  writeCount: number;
  lineCount: number;
  changedLines: number;
  width: number;
  height: number;
  postprocess: "none" | "probe" | "roundtrip" | "roundtrip-probe" | "compact" | "compact-probe" | "rainbow" | "rainbow-probe";
  fullRedrawsBefore: number;
  lineBytesBeforePostprocess: number;
  lineBytesAfterPostprocess: number;
  sgrCountBeforePostprocess: number;
  sgrCountAfterPostprocess: number;
};

type TuiPatchState = {
  installed: boolean;
  renderCounter: number;
  postprocess?: TuiPostprocessFn;
  postprocessName: FrameMetrics["postprocess"];
};

type TuiPrototype = {
  doRender(this: TuiInstance): void;
  requestRender(this: TuiInstance, force?: boolean): void;
  applyLineResets(this: TuiInstance, lines: string[]): string[];
};

type ProcessTerminalPrototype = {
  write(this: Record<PropertyKey, unknown>, data: string): void;
};

type TuiInstance = {
  terminal: Record<PropertyKey, unknown> & {
    columns: number;
    rows: number;
  };
  previousLines?: string[];
  fullRedraws?: number;
  [REQUEST_COUNT_KEY]?: number;
  [FRAME_METRICS_KEY]?: FrameMetrics | undefined;
};

const PATCH_STATE_KEY = Symbol.for("pi-plugin-rainbow.tuiPatchState");
const REQUEST_COUNT_KEY = Symbol.for("pi-plugin-rainbow.tuiRequestCount");
const FRAME_METRICS_KEY = Symbol.for("pi-plugin-rainbow.tuiFrameMetrics");
const PROBE_COLOR = "\x1b[38;5;213m";

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

const stripAnsi = (value: string) => {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1bP[\s\S]*?\x1b\\/g, "");
};

const countUtf8Bytes = (lines: string[]) => {
  return lines.reduce((total, line) => total + Buffer.byteLength(line, "utf8"), 0);
};

const countSgrSequences = (lines: string[]) => {
  return lines.reduce((total, line) => total + (line.match(/\x1b\[[\d;]*m/g)?.length ?? 0), 0);
};

const applyPostprocessRoundtrip = (lines: string[]) => {
  return emitAnsiGrid(parseAnsiGrid(lines));
};

const applyPostprocessCompact = (lines: string[]) => {
  return emitAnsiGridCompact(parseAnsiGrid(lines));
};

const getPatchState = () => {
  const scopedGlobal = globalThis as typeof globalThis & {
    [PATCH_STATE_KEY]?: TuiPatchState;
  };

  if (!scopedGlobal[PATCH_STATE_KEY]) {
    scopedGlobal[PATCH_STATE_KEY] = {
      installed: false,
      renderCounter: 0,
      postprocess: undefined,
      postprocessName: "none",
    };
  }

  return scopedGlobal[PATCH_STATE_KEY]!;
};

const chooseProbeLineIndex = (lines: string[]) => {
  return lines.findIndex((line) => stripAnsi(line).trim().length > 0);
};

export const insertAfterLeadingEscapeSequences = (line: string, text: string) => {
  let index = 0;
  while (index < line.length && line.charCodeAt(index) === 0x1b) {
    const sequence = readEscapeSequence(line, index);
    if (!sequence) {
      break;
    }
    index += sequence.length;
  }

  return line.slice(0, index) + text + line.slice(index);
};

export const applyPostprocessProbe = (lines: string[]) => {
  const index = chooseProbeLineIndex(lines);
  if (index === -1) {
    return lines;
  }

  const next = [...lines];
  next[index] = insertAfterLeadingEscapeSequences(next[index]!, PROBE_COLOR);
  return next;
};

export const shouldInstallRainbowTuiHooks = () => {
  return isRainbowRenderDebugEnabled() || isRainbowPostprocessSpikeEnabled() || isRainbowFramePostprocessEnabled();
};

const getPostprocessName = () => {
  const rainbowEnabled = isRainbowFramePostprocessEnabled();
  const spikeEnabled = isRainbowPostprocessSpikeEnabled();
  const useCompact = spikeEnabled && isRainbowPostprocessCompactEnabled();
  const useRoundtrip = spikeEnabled && isRainbowPostprocessRoundtripEnabled();
  const useProbe = spikeEnabled && isRainbowPostprocessProbeEnabled();

  if (rainbowEnabled && useProbe) return "rainbow-probe" as const;
  if (rainbowEnabled) return "rainbow" as const;
  if (useCompact && useProbe) return "compact-probe" as const;
  if (useCompact) return "compact" as const;
  if (useRoundtrip && useProbe) return "roundtrip-probe" as const;
  if (useRoundtrip) return "roundtrip" as const;
  if (useProbe) return "probe" as const;
  return "none" as const;
};

export const installRainbowTuiHooks = () => {
  const state = getPatchState();
  const rainbowEnabled = isRainbowFramePostprocessEnabled();
  const spikeEnabled = isRainbowPostprocessSpikeEnabled();
  const useCompact = spikeEnabled && isRainbowPostprocessCompactEnabled();
  const useRoundtrip = spikeEnabled && isRainbowPostprocessRoundtripEnabled() && !useCompact;
  const useProbe = spikeEnabled && isRainbowPostprocessProbeEnabled();
  state.postprocess = rainbowEnabled || useCompact || useRoundtrip || useProbe
    ? (lines, context) => {
      let next = lines;
      if (rainbowEnabled) {
        next = applyRainbowFramePostprocess(next, context);
      } else if (useCompact) {
        next = applyPostprocessCompact(next);
      } else if (useRoundtrip) {
        next = applyPostprocessRoundtrip(next);
      }
      if (useProbe) {
        next = applyPostprocessProbe(next);
      }
      return next;
    }
    : undefined;
  state.postprocessName = getPostprocessName();

  if (state.installed) {
    return;
  }

  const tuiPrototype = TUI.prototype as unknown as TuiPrototype;
  const terminalPrototype = ProcessTerminal.prototype as unknown as ProcessTerminalPrototype;
  const originalRequestRender = tuiPrototype.requestRender;
  const originalApplyLineResets = tuiPrototype.applyLineResets;
  const originalDoRender = tuiPrototype.doRender;
  const originalWrite = terminalPrototype.write;

  tuiPrototype.requestRender = function patchedRequestRender(this: TuiInstance, force?: boolean) {
    this[REQUEST_COUNT_KEY] = (this[REQUEST_COUNT_KEY] ?? 0) + 1;
    return originalRequestRender.call(this, force);
  };

  tuiPrototype.applyLineResets = function patchedApplyLineResets(this: TuiInstance, lines: string[]) {
    const nextLines = originalApplyLineResets.call(this, lines);
    const patchState = getPatchState();
    const context: TuiPostprocessContext = {
      renderIndex: this[FRAME_METRICS_KEY]?.renderIndex ?? 0,
      width: this.terminal.columns,
      height: this.terminal.rows,
      previousLines: this.previousLines,
    };
    const transformedLines = patchState.postprocess ? patchState.postprocess(nextLines, context) : nextLines;
    const metrics = this[FRAME_METRICS_KEY];
    if (metrics) {
      metrics.lineCount = transformedLines.length;
      metrics.changedLines = countChangedLines(this.previousLines, transformedLines);
      metrics.postprocess = patchState.postprocessName;
      metrics.lineBytesBeforePostprocess = countUtf8Bytes(nextLines);
      metrics.lineBytesAfterPostprocess = countUtf8Bytes(transformedLines);
      metrics.sgrCountBeforePostprocess = countSgrSequences(nextLines);
      metrics.sgrCountAfterPostprocess = countSgrSequences(transformedLines);
    }
    return transformedLines;
  };

  tuiPrototype.doRender = function patchedDoRender(this: TuiInstance) {
    const metrics: FrameMetrics = {
      renderIndex: ++state.renderCounter,
      startedAtMs: Date.now(),
      requestCalls: this[REQUEST_COUNT_KEY] ?? 0,
      bytesWritten: 0,
      writeCount: 0,
      lineCount: 0,
      changedLines: 0,
      width: this.terminal.columns,
      height: this.terminal.rows,
      postprocess: state.postprocessName,
      fullRedrawsBefore: this.fullRedraws ?? 0,
      lineBytesBeforePostprocess: 0,
      lineBytesAfterPostprocess: 0,
      sgrCountBeforePostprocess: 0,
      sgrCountAfterPostprocess: 0,
    };

    this[REQUEST_COUNT_KEY] = 0;
    this[FRAME_METRICS_KEY] = metrics;
    this.terminal[FRAME_METRICS_KEY] = metrics;

    try {
      return originalDoRender.call(this);
    } finally {
      const durationMs = Date.now() - metrics.startedAtMs;
      logRainbowDebugEvent({
        type: "frame",
        renderIndex: metrics.renderIndex,
        requestCalls: metrics.requestCalls,
        changedLines: metrics.changedLines,
        lineCount: metrics.lineCount,
        bytesWritten: metrics.bytesWritten,
        writeCount: metrics.writeCount,
        width: metrics.width,
        height: metrics.height,
        durationMs,
        postprocess: metrics.postprocess,
        lineBytesBeforePostprocess: metrics.lineBytesBeforePostprocess,
        lineBytesAfterPostprocess: metrics.lineBytesAfterPostprocess,
        sgrCountBeforePostprocess: metrics.sgrCountBeforePostprocess,
        sgrCountAfterPostprocess: metrics.sgrCountAfterPostprocess,
        fullRedrawsBefore: metrics.fullRedrawsBefore,
        fullRedrawsAfter: this.fullRedraws ?? metrics.fullRedrawsBefore,
      });
      this.terminal[FRAME_METRICS_KEY] = undefined;
      this[FRAME_METRICS_KEY] = undefined;
    }
  };

  terminalPrototype.write = function patchedTerminalWrite(this: Record<PropertyKey, unknown>, data: string) {
    const metrics = this[FRAME_METRICS_KEY] as FrameMetrics | undefined;
    if (metrics) {
      metrics.bytesWritten += Buffer.byteLength(data, "utf8");
      metrics.writeCount += 1;
    }

    return originalWrite.call(this, data);
  };

  state.installed = true;
  logRainbowDebugEvent({
    type: "install",
    hook: "tui",
    postprocess: state.postprocessName,
    spikeEnabled: isRainbowPostprocessSpikeEnabled(),
    probeEnabled: isRainbowPostprocessProbeEnabled(),
    roundtripEnabled: isRainbowPostprocessRoundtripEnabled(),
    compactEnabled: isRainbowPostprocessCompactEnabled(),
    rainbowEnabled: isRainbowFramePostprocessEnabled(),
  });
};
