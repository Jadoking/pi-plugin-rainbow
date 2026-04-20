import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import {
  createRainbowMotion,
  getRainbowColor,
  phaseAt,
} from "./motion.js";
import type { RainbowSettings } from "./settings.js";

type SplashContext = {
  ui: Pick<ExtensionCommandContext["ui"], "custom">;
};

const RESET = "\x1b[0m";
const SPLASH_FLASH_STRENGTH = 0.64;
const LOGO = [
  "██████╗ ██╗",
  "██╔══██╗██║",
  "██████╔╝██║",
  "██╔═══╝ ██║",
  "██║     ██║",
  "╚═╝     ╚═╝",
];

const mix = (from: number, to: number, strength: number) => {
  return Math.round(from + (to - from) * strength);
};

const fgCode = (r: number, g: number, b: number) => {
  return `\x1b[38;2;${r};${g};${b}m`;
};

const center = (text: string, width: number) => {
  const gap = Math.max(0, width - visibleWidth(text));
  const left = Math.floor(gap / 2);
  const right = gap - left;
  return " ".repeat(left) + text + " ".repeat(right);
};

const colorize = (text: string, elapsedMs: number, row: number, settings: RainbowSettings) => {
  const chars = Array.from(text);
  const flash = elapsedMs < 1100 ? 1 - elapsedMs / 1100 : 0;
  const motion = createRainbowMotion(chars.length, LOGO.length, settings.turns, elapsedMs, settings.speed);

  return chars
    .map((char, index) => {
      if (char === " ") return char;
      const phase = phaseAt(motion, row, index);
      const base = getRainbowColor(phase, settings.vibrance);
      const r = mix(base.r, 255, flash * SPLASH_FLASH_STRENGTH);
      const g = mix(base.g, 255, flash * SPLASH_FLASH_STRENGTH);
      const b = mix(base.b, 255, flash * SPLASH_FLASH_STRENGTH);
      return `${fgCode(r, g, b)}${char}${RESET}`;
    })
    .join("");
};

class RainbowSplash {
  readonly width = 44;
  readonly focused = true;

  private readonly startedAt = Date.now();
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly tui: { requestRender: () => void },
    private readonly theme: Theme,
    private readonly settings: RainbowSettings,
    private readonly done: () => void,
  ) {
    this.timer = setInterval(() => {
      this.tui.requestRender();
    }, 50);
  }

  dispose() {
    clearInterval(this.timer);
  }

  invalidate() {}

  handleInput(data: string) {
    if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
      this.done();
    }
  }

  render(width: number) {
    const innerWidth = Math.max(20, Math.min(this.width, width) - 2);
    const elapsedMs = Date.now() - this.startedAt;
    const lines: string[] = [];

    lines.push(this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`));
    lines.push(this.wrap(this.theme.fg("muted", "Pi Rainbow Splash"), innerWidth));
    lines.push(this.wrap("", innerWidth));

    for (let row = 0; row < LOGO.length; row += 1) {
      lines.push(this.wrap(colorize(LOGO[row]!, elapsedMs, row, this.settings), innerWidth));
    }

    lines.push(this.wrap("", innerWidth));
    lines.push(this.wrap(this.theme.fg("muted", "ctrl+shift+r or /rainbow-splash"), innerWidth));
    lines.push(this.wrap(this.theme.fg("dim", "Esc, Enter, or Space to close"), innerWidth));
    lines.push(this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`));

    return lines.map((line) => truncateToWidth(line, width));
  }

  private wrap(content: string, innerWidth: number) {
    return this.theme.fg("border", "│") + center(content, innerWidth) + this.theme.fg("border", "│");
  }
}

export const showRainbowSplash = async (ctx: SplashContext, settings: RainbowSettings) => {
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      return new RainbowSplash(tui, theme, settings, done);
    },
    { overlay: true },
  );
};
