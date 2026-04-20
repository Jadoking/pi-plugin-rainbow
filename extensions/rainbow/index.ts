import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { installAssistantMessagePatch } from "./assistant-patch.js";
import { RainbowEditor } from "./editor.js";
import { showRainbowSettingsDialog } from "./settings-dialog.js";
import {
  DEFAULT_SETTINGS,
  RainbowSettingsStore,
  loadSettings,
  saveSettings,
  type RainbowSettings,
} from "./settings.js";
import { showRainbowSplash } from "./splash.js";

const STATUS_ID = "pi-plugin-rainbow";
const SPLASH_SHORTCUT = "ctrl+shift+r";

const formatNumber = (value: number, digits: number) => {
  return value.toFixed(digits);
};

export default function rainbowPlugin(pi: ExtensionAPI) {
  const store = new RainbowSettingsStore(DEFAULT_SETTINGS);
  let loadPromise: Promise<void> | undefined;

  installAssistantMessagePatch(store);

  const ensureLoaded = async () => {
    if (!loadPromise) {
      loadPromise = loadSettings().then((next) => {
        store.set(next);
      });
    }

    await loadPromise;
  };

  const setStatus = (ctx: { hasUI: boolean; ui: { setStatus: (id: string, text: string | undefined) => void; theme: any } }, settings = store.get()) => {
    if (!ctx.hasUI) return;

    if (!settings.showStatus) {
      ctx.ui.setStatus(STATUS_ID, undefined);
      return;
    }

    const theme = ctx.ui.theme;
    const label = settings.enabled ? theme.fg("success", "rainbow") : theme.fg("dim", "rainbow off");
    const detail = theme.fg(
      "dim",
      ` fg:${settings.fg ? "on" : "off"} speed:${formatNumber(settings.speed, 3)} turns:${formatNumber(settings.turns, 2)} vibrance:${formatNumber(settings.vibrance, 2)}`,
    );
    ctx.ui.setStatus(STATUS_ID, `${label}${detail}`);
  };

  const applySettings = (ctx: { hasUI: boolean; ui: { notify: (text: string, level: "error") => void; setStatus: (id: string, text: string | undefined) => void; theme: any } }, next: RainbowSettings) => {
    store.set(next);
    setStatus(ctx, next);

    void saveSettings(next).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "failed to save settings";
      ctx.ui.notify(`Rainbow settings were updated in-memory, but persistence failed: ${message}`, "error");
    });
  };

  pi.on("session_start", async (_event, ctx) => {
    await ensureLoaded();

    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setEditorComponent((tui, theme, keybindings) => {
      return new RainbowEditor(tui, theme, keybindings, store);
    });

    setStatus(ctx);
  });

  pi.registerCommand("rainbow-settings", {
    description: "Adjust the Pi rainbow effect live",
    handler: async (_args, ctx) => {
      await ensureLoaded();

      if (!ctx.hasUI) {
        ctx.ui.notify("Rainbow settings require interactive mode", "error");
        return;
      }

      await showRainbowSettingsDialog(ctx, store, (next) => {
        applySettings(ctx, next);
      });
    },
  });

  pi.registerCommand("rainbow-reset", {
    description: "Reset rainbow settings to their defaults",
    handler: async (_args, ctx) => {
      await ensureLoaded();
      applySettings(ctx, { ...DEFAULT_SETTINGS });
      ctx.ui.notify("Rainbow settings reset to defaults", "info");
    },
  });

  pi.registerCommand("rainbow-splash", {
    description: "Show the Pi rainbow splash overlay",
    handler: async (_args, ctx) => {
      await ensureLoaded();

      if (!ctx.hasUI) {
        ctx.ui.notify("Rainbow splash requires interactive mode", "error");
        return;
      }

      await showRainbowSplash(ctx, store.get());
    },
  });

  pi.registerShortcut(SPLASH_SHORTCUT, {
    description: "Show the Pi rainbow splash overlay",
    handler: async (ctx) => {
      await ensureLoaded();

      if (!ctx.hasUI) {
        return;
      }

      await showRainbowSplash(ctx, store.get());
    },
  });
}
