import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { createRainbowMotion, getRainbowColor, phaseAt } from "./motion.js";
import { getNextRainbowPresetId, getPreviousRainbowPresetId, getRainbowPreset } from "./presets.js";
import { DEFAULT_SETTINGS, type RainbowSettings, type RainbowSettingsStore } from "./settings.js";

type ToggleField = "enabled" | "fg" | "colorInput" | "colorToolBoxes" | "animateToolBoxes" | "showStatus";
type NumberField = "speed" | "turns";
type PresetField = "preset";
type Field = ToggleField | NumberField | PresetField;

type RowBase = {
  key: Field;
  title: string;
};

type ToggleRow = RowBase & {
  kind: "toggle";
  description: string;
};

type NumberRow = RowBase & {
  kind: "number";
  description: string;
  step: number;
  min: number;
  max: number;
  digits: number;
};

type PresetRow = RowBase & {
  kind: "preset";
};

type Row = ToggleRow | NumberRow | PresetRow;

type RequestRender = () => void;

const ROWS: Row[] = [
  {
    key: "enabled",
    title: "Plugin enabled",
    description: "Master switch for the palette-driven effect",
    kind: "toggle",
  },
  {
    key: "fg",
    title: "Foreground effect",
    description: "Colorize the rainbow editor, assistant text, and prompt outlines",
    kind: "toggle",
  },
  {
    key: "colorInput",
    title: "Color typed input",
    description: "Recolor text while typing in the editor. Off by default until the editor path is faster.",
    kind: "toggle",
  },
  {
    key: "colorToolBoxes",
    title: "Color tool boxes",
    description: "Tint tool call and result boxes with the active palette while preserving pending, success, and error semantics.",
    kind: "toggle",
  },
  {
    key: "animateToolBoxes",
    title: "Animate tool boxes",
    description: "Animate pending tool boxes only, then freeze them in place as soon as they complete.",
    kind: "toggle",
  },
  {
    key: "showStatus",
    title: "Footer status",
    description: "Show or hide the active preset in Pi's footer",
    kind: "toggle",
  },
  {
    key: "preset",
    title: "Palette preset",
    kind: "preset",
  },
  {
    key: "speed",
    title: "Animation speed",
    description: "Only animates while Pi is actively working; idle state stays on the base palette",
    kind: "number",
    step: 0.001,
    min: 0,
    max: 0.03,
    digits: 3,
  },
  {
    key: "turns",
    title: "Band count",
    description: "Controls how many diagonal color bands span the themed gradient",
    kind: "number",
    step: 0.25,
    min: 0.25,
    max: 8,
    digits: 2,
  },
];

const RESET = "\x1b[0m";
const PREVIEW_TICK_MS = 33;
const PREVIEW_BAR_CHAR = "█";
const PREVIEW_TEXT = " PI RAINBOW PREVIEW ";

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const fgCode = (r: number, g: number, b: number) => {
  return `\x1b[38;2;${r};${g};${b}m`;
};

const colorizePreviewLine = (text: string, row: number, settings: RainbowSettings, elapsedMs: number) => {
  const motion = createRainbowMotion(Math.max(1, visibleWidth(text)), 2, settings.turns, elapsedMs, settings.speed);
  let result = "";
  let column = 0;

  for (const char of Array.from(text)) {
    const width = visibleWidth(char);
    if (width === 0) {
      result += char;
      continue;
    }

    if (char === " ") {
      result += char;
      column += width;
      continue;
    }

    const phase = phaseAt(motion, row, column);
    const color = getRainbowColor(phase, settings.preset);
    result += `${fgCode(color.r, color.g, color.b)}${char}${RESET}`;
    column += width;
  }

  return result;
};

export const renderPresetPreview = (presetId: string) => {
  return getRainbowPreset(presetId).colors.map((color) => `${fgCode(color.r, color.g, color.b)}██${RESET}`).join(" ");
};

export const renderAnimationPreview = (settings: RainbowSettings, width: number, elapsedMs: number) => {
  const contentWidth = Math.max(12, width);
  const previewText = PREVIEW_TEXT.repeat(Math.ceil(contentWidth / PREVIEW_TEXT.length)).slice(0, contentWidth);
  const previewBar = PREVIEW_BAR_CHAR.repeat(contentWidth);

  return [
    colorizePreviewLine(previewBar, 0, settings, elapsedMs),
    colorizePreviewLine(previewText, 1, settings, elapsedMs),
  ];
};

const formatValue = (settings: RainbowSettings, row: Row) => {
  if (row.kind === "toggle") {
    return settings[row.key] ? "ON" : "OFF";
  }

  if (row.kind === "preset") {
    return getRainbowPreset(settings.preset).name;
  }

  return settings[row.key as NumberField].toFixed(row.digits);
};

const describeRow = (settings: RainbowSettings, row: Row) => {
  if (row.kind === "preset") {
    return getRainbowPreset(settings.preset).description;
  }

  return row.description;
};

const pad = (text: string, width: number) => {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
};

const wrapRowContent = (content: string, width: number) => {
  return wrapTextWithAnsi(content, Math.max(1, width));
};

export class RainbowSettingsDialog {
  readonly width = 92;

  private readonly startedAtMs: number;
  private selected = 0;
  private value: RainbowSettings;
  private previewTimer: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly theme: Theme,
    initial: RainbowSettings,
    private readonly onChange: (next: RainbowSettings) => void,
    private readonly done: () => void,
    private readonly requestRender?: RequestRender,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.value = initial;
    this.startedAtMs = this.now();
    this.syncPreviewTimer();
  }

  dispose() {
    this.stopPreviewTimer();
  }

  handleInput(data: string) {
    const current = ROWS[this.selected];
    if (!current) return;

    if (matchesKey(data, Key.escape)) {
      this.done();
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.selected = Math.max(0, this.selected - 1);
      return;
    }

    if (matchesKey(data, Key.down)) {
      this.selected = Math.min(ROWS.length - 1, this.selected + 1);
      return;
    }

    if (data.toLowerCase() === "r") {
      this.apply({ ...DEFAULT_SETTINGS });
      return;
    }

    if (current.kind === "toggle") {
      if (matchesKey(data, Key.enter) || matchesKey(data, Key.space) || matchesKey(data, Key.left) || matchesKey(data, Key.right)) {
        this.apply({
          ...this.value,
          [current.key]: !this.value[current.key],
        });
      }
      return;
    }

    if (current.kind === "preset") {
      if (matchesKey(data, Key.left)) {
        this.cyclePreset(-1);
        return;
      }

      if (matchesKey(data, Key.right) || matchesKey(data, Key.enter) || matchesKey(data, Key.space)) {
        this.cyclePreset(1);
      }
      return;
    }

    if (matchesKey(data, Key.left)) {
      this.adjust(current, -1);
      return;
    }

    if (matchesKey(data, Key.right) || matchesKey(data, Key.enter)) {
      this.adjust(current, 1);
    }
  }

  invalidate() {}

  render(width: number) {
    const innerWidth = Math.max(24, Math.min(this.width, width) - 2);
    const previewWidth = Math.max(12, innerWidth - 4);
    const previewElapsedMs = this.now() - this.startedAtMs;
    const lines: string[] = [];
    const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const footer = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    const row = (content = "") => {
      lines.push(this.theme.fg("border", "│") + pad(content, innerWidth) + this.theme.fg("border", "│"));
    };
    const wrappedRow = (content: string) => {
      for (const line of wrapRowContent(content, innerWidth)) {
        row(line);
      }
    };
    const wrappedIndentedRow = (indent: string, content: string) => {
      const availableWidth = Math.max(1, innerWidth - visibleWidth(indent));
      const wrapped = wrapRowContent(content, availableWidth);
      if (wrapped.length === 0) {
        row(indent);
        return;
      }
      for (const line of wrapped) {
        row(indent + line);
      }
    };

    lines.push(border);
    wrappedRow(`${this.theme.bold(this.theme.fg("accent", "Rainbow Theme Settings"))}`);
    wrappedRow(this.theme.fg("muted", "Preset-driven color theming for Pi"));
    row();
    wrappedRow(this.theme.fg("dim", "Animation preview"));
    for (const previewLine of renderAnimationPreview(this.value, previewWidth, previewElapsedMs)) {
      row("  " + previewLine);
    }
    row();

    for (let index = 0; index < ROWS.length; index += 1) {
      const item = ROWS[index]!;
      const selected = index === this.selected;
      const prefix = selected ? this.theme.fg("accent", "▶ ") : "  ";
      const title = selected ? this.theme.fg("accent", item.title) : this.theme.fg("text", item.title);
      const value = selected
        ? this.theme.fg("accent", formatValue(this.value, item))
        : this.theme.fg("muted", formatValue(this.value, item));
      const space = Math.max(1, innerWidth - visibleWidth(prefix + title) - visibleWidth(value));

      row(prefix + title + " ".repeat(space) + value);
      wrappedIndentedRow("    ", this.theme.fg("muted", describeRow(this.value, item)));
      if (item.kind === "preset") {
        wrappedIndentedRow("    ", this.theme.fg("dim", "Palette ") + renderPresetPreview(this.value.preset));
      }
    }

    row();
    wrappedRow(this.theme.fg("dim", "↑↓ move  left/right adjust  Enter/Space toggle or cycle  r reset  Esc close"));
    lines.push(footer);

    return lines.map((line) => truncateToWidth(line, width));
  }

  private syncPreviewTimer() {
    if (!this.requestRender || this.value.speed <= 0) {
      this.stopPreviewTimer();
      return;
    }

    if (this.previewTimer) {
      return;
    }

    this.previewTimer = setInterval(() => {
      this.requestRender?.();
    }, PREVIEW_TICK_MS);
  }

  private stopPreviewTimer() {
    if (!this.previewTimer) return;
    clearInterval(this.previewTimer);
    this.previewTimer = undefined;
  }

  private cyclePreset(direction: -1 | 1) {
    this.apply({
      ...this.value,
      preset:
        direction > 0
          ? getNextRainbowPresetId(this.value.preset)
          : getPreviousRainbowPresetId(this.value.preset),
    });
  }

  private adjust(row: NumberRow, direction: -1 | 1) {
    const current = this.value[row.key as NumberField];
    const next = Number(clamp(current + row.step * direction, row.min, row.max).toFixed(row.digits));
    this.apply({
      ...this.value,
      [row.key]: next,
    });
  }

  private apply(next: RainbowSettings) {
    this.value = next;
    this.syncPreviewTimer();
    this.onChange(next);
    this.requestRender?.();
  }
}

export const showRainbowSettingsDialog = async (
  ctx: ExtensionCommandContext,
  store: RainbowSettingsStore,
  onChange: (next: RainbowSettings) => void,
) => {
  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      return new RainbowSettingsDialog(theme, store.get(), onChange, done, () => tui.requestRender());
    },
    { overlay: true },
  );
};
