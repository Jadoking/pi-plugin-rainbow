import { CustomEditor } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

import {
  createRainbowMotion,
  getRainbowColor,
  phaseAt,
  type RainbowMotion,
} from "./motion.js";
import type { RainbowSettings, RainbowSettingsStore } from "./settings.js";

const RESET = "\x1b[0m";
const ANSI_SGR_RESET = /^\x1b\[(?:0(?:;0)*)?m$/;

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const frameMs = (settings: RainbowSettings) => {
  const minFps = 12;
  const maxFps = 24;
  const phaseStep = 0.05;
  const phaseRate = settings.speed * (settings.fg ? 0.1 : 0.04);

  if (phaseRate <= 0) return 1000 / minFps;

  return clamp(phaseStep / phaseRate, 1000 / maxFps, 1000 / minFps);
};

const shouldAnimate = (settings: RainbowSettings) => {
  return settings.enabled && settings.fg;
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

const applyRainbowToLine = (
  line: string,
  row: number,
  motion: RainbowMotion,
  settings: RainbowSettings,
) => {
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
    const fg = getRainbowColor(phase, settings.vibrance);
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
  private readonly startedAt = Date.now();
  private readonly unsubscribe: () => void;
  private timer: ReturnType<typeof setInterval> | undefined;
  private timerDelay = -1;

  constructor(tui: any, theme: any, keybindings: any, private readonly store: RainbowSettingsStore) {
    super(tui, theme, keybindings);

    this.unsubscribe = store.subscribe(() => {
      this.syncAnimation();
      this.tui.requestRender();
    });

    this.syncAnimation();
  }

  dispose() {
    this.stopAnimation();
    this.unsubscribe();
  }

  render(width: number) {
    const lines = super.render(width);
    const settings = this.store.get();

    if (!shouldAnimate(settings)) {
      return lines;
    }

    const elapsedMs = Date.now() - this.startedAt;
    const motion = createRainbowMotion(width, lines.length, settings.turns, elapsedMs, settings.speed);
    return lines.map((line, row) => applyRainbowToLine(line, row, motion, settings));
  }

  private syncAnimation() {
    const settings = this.store.get();

    if (!shouldAnimate(settings)) {
      this.stopAnimation();
      return;
    }

    const nextDelay = Math.round(frameMs(settings));
    if (this.timer && this.timerDelay === nextDelay) {
      return;
    }

    this.stopAnimation();
    this.timerDelay = nextDelay;
    this.timer = setInterval(() => {
      this.tui.requestRender();
    }, nextDelay);
  }

  private stopAnimation() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.timerDelay = -1;
  }
}
