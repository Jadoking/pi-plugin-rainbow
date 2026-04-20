import type { ExtensionCommandContext, Theme } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

import { DEFAULT_SETTINGS, type RainbowSettings, type RainbowSettingsStore } from "./settings.js";

type ToggleField = "enabled" | "fg" | "showStatus";
type NumberField = "speed" | "turns" | "vibrance";
type Field = ToggleField | NumberField;

type RowBase = {
  key: Field;
  title: string;
  description: string;
};

type ToggleRow = RowBase & {
  kind: "toggle";
};

type NumberRow = RowBase & {
  kind: "number";
  step: number;
  min: number;
  max: number;
  digits: number;
};

type Row = ToggleRow | NumberRow;

const ROWS: Row[] = [
  {
    key: "enabled",
    title: "Plugin enabled",
    description: "Master switch for the ambient effect",
    kind: "toggle",
  },
  {
    key: "fg",
    title: "Foreground effect",
    description: "Animate editor text, prompt outlines, and rendered output",
    kind: "toggle",
  },
  {
    key: "showStatus",
    title: "Footer status",
    description: "Show or hide the rainbow status text at the bottom of Pi",
    kind: "toggle",
  },
  {
    key: "speed",
    title: "Animation speed",
    description: "Controls how quickly the rainbow moves",
    kind: "number",
    step: 0.001,
    min: 0,
    max: 0.03,
    digits: 3,
  },
  {
    key: "turns",
    title: "Band count",
    description: "Controls how many diagonal bands span the rainbow",
    kind: "number",
    step: 0.25,
    min: 0.25,
    max: 8,
    digits: 2,
  },
  {
    key: "vibrance",
    title: "Color vibrance",
    description: "Controls how soft or vivid the rainbow colors feel",
    kind: "number",
    step: 0.05,
    min: 0,
    max: 1,
    digits: 2,
  },
];

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const formatValue = (settings: RainbowSettings, row: Row) => {
  if (row.kind === "toggle") {
    return settings[row.key] ? "ON" : "OFF";
  }

  return settings[row.key as NumberField].toFixed(row.digits);
};

const pad = (text: string, width: number) => {
  return text + " ".repeat(Math.max(0, width - visibleWidth(text)));
};

class RainbowSettingsDialog {
  readonly width = 76;

  private selected = 0;
  private value: RainbowSettings;

  constructor(
    private readonly theme: Theme,
    initial: RainbowSettings,
    private readonly onChange: (next: RainbowSettings) => void,
    private readonly done: () => void,
  ) {
    this.value = initial;
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
    const lines: string[] = [];
    const border = this.theme.fg("border", `╭${"─".repeat(innerWidth)}╮`);
    const footer = this.theme.fg("border", `╰${"─".repeat(innerWidth)}╯`);
    const row = (content = "") => {
      lines.push(this.theme.fg("border", "│") + pad(content, innerWidth) + this.theme.fg("border", "│"));
    };

    lines.push(border);
    row(`${this.theme.bold(this.theme.fg("accent", "Rainbow Settings"))}`);
    row(this.theme.fg("muted", "Pi-native port of oc-plugin-rainbow"));
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
      row("    " + this.theme.fg("muted", item.description));
    }

    row();
    row(this.theme.fg("dim", "↑↓ move  left/right adjust  Enter/Space toggle  r reset  Esc close"));
    lines.push(footer);

    return lines.map((line) => truncateToWidth(line, width));
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
    this.onChange(next);
  }
}

export const showRainbowSettingsDialog = async (
  ctx: ExtensionCommandContext,
  store: RainbowSettingsStore,
  onChange: (next: RainbowSettings) => void,
) => {
  await ctx.ui.custom<void>(
    (_tui, theme, _keybindings, done) => {
      return new RainbowSettingsDialog(theme, store.get(), onChange, done);
    },
    { overlay: true },
  );
};
