import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

import {
  createRainbowMotion,
  getRainbowColor,
  phaseAt,
  type RainbowMotion,
} from "./motion.js";
import type { RainbowAnimationController } from "./runtime.js";
import type { RainbowSettings, RainbowSettingsStore } from "./settings.js";

const RESET = "\x1b[0m";
const ANSI_SGR_RESET = /^\x1b\[(?:0(?:;0)*)?m$/;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const EDITOR_INPUT_SETTLE_MS = 180;
const INPUT_FRAME_DELAY_MULTIPLIER = 2;

export const isEditorInputSettling = (lastInputAtMs: number, nowMs: number) => {
  return nowMs - lastInputAtMs < EDITOR_INPUT_SETTLE_MS;
};

export const getEditorAnimationDelayMs = (settings: RainbowSettings, inputSettling = false) => {
  const minFps = 20;
  const maxFps = 30;
  const phaseStep = 0.03;
  const phaseRate = settings.speed * (settings.fg ? 0.1 : 0.04);

  const baseDelay = phaseRate <= 0
    ? 1000 / minFps
    : clamp(phaseStep / phaseRate, 1000 / maxFps, 1000 / minFps);

  return inputSettling ? baseDelay * INPUT_FRAME_DELAY_MULTIPLIER : baseDelay;
};

const shouldDecorateEditor = (settings: RainbowSettings) => {
  return settings.enabled && settings.fg;
};

const stripAnsi = (value: string) => {
  return value
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
};

export const isEditorChromeLine = (line: string) => {
  const plain = stripAnsi(line).trimEnd();
  return /^─+$/.test(plain) || /^─── [↑↓] \d+ more(?: ─+)?$/.test(plain);
};

export const getEditorLineColorMode = (line: string, settings: RainbowSettings): "all" | "none" => {
  if (!shouldDecorateEditor(settings)) {
    return "none";
  }

  if (isEditorChromeLine(line)) {
    return "all";
  }

  return settings.colorInput ? "all" : "none";
};

const shouldAnimate = (settings: RainbowSettings, animation: RainbowAnimationController) => {
  return shouldDecorateEditor(settings) && settings.speed > 0 && animation.isAnimating();
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

const haveSameLines = (previous: string[] | undefined, next: string[]) => {
  return !!previous
    && previous.length === next.length
    && previous.every((line, index) => line === next[index]);
};

const applyRainbowToLine = (
  line: string,
  row: number,
  motion: RainbowMotion,
  settings: RainbowSettings,
) => {
  if (getEditorLineColorMode(line, settings) === "none") {
    return line;
  }

  let activeAnsi = RESET;
  let result = "";
  let column = 0;
  let changed = false;

  for (let i = 0; i < line.length; ) {
    if (line.charCodeAt(i) === 0x1b) {
      const sequence = readEscapeSequence(line, i);
      if (sequence) {
        result += sequence;

        if (sequence.endsWith("m")) {
          activeAnsi = ANSI_SGR_RESET.test(sequence)
            ? RESET
            : activeAnsi === RESET
              ? sequence
              : `${activeAnsi}${sequence}`;
        }

        i += sequence.length;
        continue;
      }
    }

    const codePoint = line.codePointAt(i);
    if (codePoint === undefined) break;

    const char = String.fromCodePoint(codePoint);
    const charWidth = visibleWidth(char);
    if (charWidth === 0) {
      result += char;
      i += char.length;
      continue;
    }

    const phase = phaseAt(motion, row, column);
    const fg = getRainbowColor(phase, settings.preset, settings.vibrance);
    let codes = "";

    if (settings.fg && char !== " " && char !== "\t") {
      codes += fgCode(fg.r, fg.g, fg.b);
    }

    if (codes) {
      result += `${codes}${char}${activeAnsi}`;
      changed = true;
    } else {
      result += char;
    }

    column += charWidth;
    i += char.length;
  }

  return changed ? `${result}${RESET}` : line;
};

export class RainbowEditor extends CustomEditor {
  private readonly unsubscribers: Array<() => void> = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private timerDelay = -1;
  private lastInputAtMs = Number.NEGATIVE_INFINITY;
  private frozenChromeFrame = 0;
  private cachedBaseLines?: string[];
  private cachedRenderKey?: string;
  private cachedLines?: string[];

  constructor(
    tui: any,
    theme: any,
    keybindings: any,
    private readonly store: RainbowSettingsStore,
    private readonly animation: RainbowAnimationController,
  ) {
    super(tui, theme, keybindings);

    this.unsubscribers.push(
      store.subscribe(() => {
        this.syncAnimation();
        this.tui.requestRender();
      }),
      animation.subscribe(() => {
        this.syncAnimation();
        this.tui.requestRender();
      }),
    );

    this.syncAnimation();
  }

  dispose() {
    this.stopAnimation();
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
  }

  override handleInput(data: string): void {
    this.lastInputAtMs = Date.now();
    super.handleInput(data);
    this.syncAnimation();
  }

  render(width: number) {
    const lines = super.render(width);
    const settings = this.store.get();

    if (!shouldDecorateEditor(settings)) {
      this.cachedBaseLines = undefined;
      this.cachedRenderKey = undefined;
      this.cachedLines = undefined;
      return lines;
    }

    const nowMs = Date.now();
    const inputSettling = isEditorInputSettling(this.lastInputAtMs, nowMs);
    const elapsedMs = this.animation.getElapsedMs(nowMs);
    const baseDelay = Math.max(1, getEditorAnimationDelayMs(settings, false));
    const baseFrame = shouldAnimate(settings, this.animation)
      ? Math.floor(elapsedMs / baseDelay)
      : 0;
    const frame = inputSettling ? this.frozenChromeFrame : baseFrame;
    if (!inputSettling) {
      this.frozenChromeFrame = baseFrame;
    }
    const key = `${width}:${settings.preset}:${settings.turns}:${settings.speed}:${settings.vibrance}:${settings.colorInput ? 1 : 0}:${inputSettling ? 1 : 0}:${frame}`;

    if (this.cachedLines && this.cachedRenderKey === key && haveSameLines(this.cachedBaseLines, lines)) {
      return this.cachedLines;
    }

    const motion = createRainbowMotion(width, lines.length, settings.turns, frame * baseDelay, settings.speed);
    const nextLines = lines.map((line, row) => applyRainbowToLine(line, row, motion, settings));
    this.cachedBaseLines = [...lines];
    this.cachedRenderKey = key;
    this.cachedLines = nextLines;
    return nextLines;
  }

  private syncAnimation() {
    const settings = this.store.get();

    if (!shouldAnimate(settings, this.animation)) {
      this.stopAnimation();
      return;
    }

    const nextDelay = Math.round(getEditorAnimationDelayMs(settings, this.isInputSettling()));
    if (this.timer && this.timerDelay === nextDelay) {
      return;
    }

    this.stopAnimation();
    this.timerDelay = nextDelay;
    this.timer = setInterval(() => {
      const animating = this.animation.isAnimating();
      this.tui.requestRender();
      if (!animating || this.timerDelay !== Math.round(getEditorAnimationDelayMs(this.store.get(), this.isInputSettling()))) {
        this.syncAnimation();
      }
    }, nextDelay);
  }

  private isInputSettling() {
    return isEditorInputSettling(this.lastInputAtMs, Date.now());
  }

  private stopAnimation() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.timerDelay = -1;
  }
}
