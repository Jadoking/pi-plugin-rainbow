import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { DEFAULT_VIBRANCE, normalizeVibrance } from "./motion.js";

export type RainbowSettings = {
  enabled: boolean;
  fg: boolean;
  showStatus: boolean;
  bg: boolean;
  speed: number;
  turns: number;
  vibrance: number;
  glow: number;
};

type Listener = (value: RainbowSettings) => void;

export const DEFAULT_SETTINGS: RainbowSettings = {
  enabled: true,
  fg: true,
  showStatus: false,
  bg: false,
  speed: 0.008,
  turns: 3,
  vibrance: DEFAULT_VIBRANCE,
  glow: 0.05,
};

const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
const SETTINGS_PATH = join(PI_AGENT_DIR, "state", "pi-plugin-rainbow.json");

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const numberValue = (value: unknown, fallback: number) => {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
};

const boolValue = (value: unknown, fallback: boolean) => {
  return typeof value === "boolean" ? value : fallback;
};

export const normalizeSettings = (value: Partial<RainbowSettings> | undefined): RainbowSettings => {
  return {
    enabled: boolValue(value?.enabled, DEFAULT_SETTINGS.enabled),
    fg: boolValue(value?.fg, DEFAULT_SETTINGS.fg),
    showStatus: boolValue(value?.showStatus, DEFAULT_SETTINGS.showStatus),
    // Background tinting is intentionally disabled in the Pi port.
    bg: false,
    speed: clamp(numberValue(value?.speed, DEFAULT_SETTINGS.speed), 0, 0.03),
    turns: clamp(numberValue(value?.turns, DEFAULT_SETTINGS.turns), 0.25, 8),
    vibrance: normalizeVibrance(numberValue(value?.vibrance, DEFAULT_SETTINGS.vibrance)),
    glow: clamp(numberValue(value?.glow, DEFAULT_SETTINGS.glow), 0, 0.15),
  };
};

export const loadSettings = async () => {
  try {
    const raw = await readFile(SETTINGS_PATH, "utf8");
    return normalizeSettings(JSON.parse(raw) as Partial<RainbowSettings>);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

let writeChain: Promise<void> = Promise.resolve();

export const saveSettings = (value: RainbowSettings) => {
  const next = normalizeSettings(value);

  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      await mkdir(dirname(SETTINGS_PATH), { recursive: true });
      await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    });

  return writeChain;
};

export class RainbowSettingsStore {
  private value: RainbowSettings;
  private listeners = new Set<Listener>();

  constructor(initial: RainbowSettings) {
    this.value = normalizeSettings(initial);
  }

  get() {
    return this.value;
  }

  set(next: RainbowSettings) {
    this.value = normalizeSettings(next);
    for (const listener of this.listeners) {
      listener(this.value);
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
