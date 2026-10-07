/**
 * pi-rainbow — entry point.
 *
 * Registers the commands, the shortcuts, the status line and the invisible
 * widget whose only job is to hand us the TUI instance so the hook can patch
 * its render path.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { RainbowEngine } from "./engine.js";
import { GRADIENT_MODES, MOTION_MODES, type GradientMode, type MotionMode } from "./field.js";
import { allFx, getFx } from "./fx.js";
import { findPreset, nextPresetId, PRESETS, presetIds, prevPresetId } from "./presets.js";
import {
	BUNDLES,
	DEFAULT_SETTINGS,
	getBundle,
	loadSettings,
	normalizeSettings,
	type RainbowSettings,
	saveSettings,
} from "./settings.js";
import { SCOPES } from "./layout.js";
import { showRainbowSettingsDialog } from "./settings-dialog.js";
import { showRainbowSplash } from "./splash.js";
import { RainbowTuiHook } from "./tui-hook.js";

const STATUS_ID = "pi-plugin-rainbow";
const WIDGET_ID = "pi-plugin-rainbow-hook";

type AnyCtx = {
	hasUI: boolean;
	ui: {
		notify: (text: string, level?: "info" | "warning" | "error") => void;
		setStatus: (id: string, text: string | undefined) => void;
		setWidget: (key: string, content: unknown, options?: unknown) => void;
		theme: { fg: (role: string, text: string) => string };
	};
};

export default function rainbowPlugin(pi: ExtensionAPI) {
	let settings: RainbowSettings = { ...DEFAULT_SETTINGS };
	let loaded: Promise<void> | undefined;
	let frameMs = 0;

	const engine = new RainbowEngine(settings);
	const hook = new RainbowTuiHook({
		engine,
		getSettings: () => settings,
		onFrame: (ms) => {
			frameMs = ms;
		},
	});

	const ensureLoaded = async () => {
		if (!loaded) {
			loaded = loadSettings().then((next) => {
				settings = next;
				engine.updateSettings(next);
			});
		}
		await loaded;
	};

	const setStatus = (ctx: AnyCtx) => {
		if (!ctx.hasUI) return;
		if (!settings.showStatus) {
			ctx.ui.setStatus(STATUS_ID, undefined);
			return;
		}
		const theme = ctx.ui.theme;
		const preset = findPreset(settings.preset);
		const fxCount = Object.values(settings.fx).filter((v) => v > 0).length;
		const head = settings.enabled
			? theme.fg("success", "◆ rainbow")
			: theme.fg("dim", "◇ rainbow off");
		const detail = theme.fg(
			"dim",
			` ${preset?.id ?? settings.preset} · ${settings.scope} · ${settings.mode}/${settings.motion} · ${fxCount}fx` +
				(hook.fps > 0 ? ` · ${hook.fps}fps` : " · static") +
				(frameMs > 0.1 ? ` · ${frameMs.toFixed(1)}ms` : ""),
		);
		ctx.ui.setStatus(STATUS_ID, `${head}${detail}`);
	};

	const apply = (ctx: AnyCtx, next: Partial<RainbowSettings>, message?: string) => {
		settings = normalizeSettings({ ...settings, ...next });
		engine.updateSettings(settings);
		hook.restartPump();
		hook.refresh();
		setStatus(ctx);
		if (message && ctx.hasUI) ctx.ui.notify(message, "info");
		void saveSettings(settings).catch((error: unknown) => {
			const m = error instanceof Error ? error.message : "failed to save";
			ctx.ui.notify(`Rainbow: settings applied but not saved (${m})`, "error");
		});
	};

	/* ------------------------------------------------------------ *
	 * Lifecycle
	 * ------------------------------------------------------------ */

	pi.on("session_start", async (_event, ctx) => {
		await ensureLoaded();
		const c = ctx as unknown as AnyCtx;
		if (!c.hasUI) return;

		// An invisible widget is the least invasive way to get the TUI handle:
		// it renders nothing, it just captures the instance on first render.
		c.ui.setWidget(WIDGET_ID, (tui: unknown) => {
			hook.attach(tui);
			return {
				render: () => [] as string[],
				dispose: () => hook.detach(),
			};
		});

		setStatus(c);
		if (settings.splashOnStart && settings.enabled) {
			void showRainbowSplash(ctx, settings);
		}
	});

	pi.on("before_agent_start", async () => {
		engine.pulse(0.6);
		hook.restartPump();
	});

	pi.on("agent_end", async () => {
		engine.pulse(0.35);
		hook.restartPump();
	});

	pi.on("session_shutdown", async () => {
		hook.dispose();
	});

	/* ------------------------------------------------------------ *
	 * Commands
	 * ------------------------------------------------------------ */

	pi.registerCommand("rainbow", {
		description: "Toggle the rainbow on or off",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const arg = args.trim().toLowerCase();
			const next = arg === "on" ? true : arg === "off" ? false : !settings.enabled;
			apply(c, { enabled: next }, `Rainbow ${next ? "on" : "off"}`);
		},
	});

	pi.registerCommand("rainbow-settings", {
		description: "Open the live rainbow settings dialog",
		handler: async (_args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			if (!c.hasUI) {
				c.ui.notify("Rainbow settings need interactive mode", "error");
				return;
			}
			hook.setSuspended(true);
			try {
				await showRainbowSettingsDialog(ctx, settings, (next) => apply(c, next));
			} finally {
				hook.setSuspended(false);
				setStatus(c);
			}
		},
	});

	pi.registerCommand("rainbow-preset", {
		description: "Pick a colour palette: <id> | next | prev | list | random",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const q = args.trim().toLowerCase();

			if (!q || q === "list") {
				const byGroup = new Map<string, string[]>();
				for (const p of PRESETS) {
					const list = byGroup.get(p.group) ?? [];
					list.push(p.id);
					byGroup.set(p.group, list);
				}
				const text = [...byGroup.entries()]
					.map(([g, ids]) => `${g}: ${ids.join(", ")}`)
					.join("\n");
				c.ui.notify(`${PRESETS.length} palettes\n${text}`, "info");
				return;
			}

			let id: string | undefined;
			if (q === "next") id = nextPresetId(settings.preset);
			else if (q === "prev" || q === "previous") id = prevPresetId(settings.preset);
			else if (q === "random") {
				const ids = presetIds();
				id = ids[Math.floor(Math.random() * ids.length)];
			} else id = findPreset(q)?.id;

			if (!id) {
				c.ui.notify(`Unknown palette "${q}". Try /rainbow-preset list`, "error");
				return;
			}
			apply(c, { preset: id }, `Palette: ${findPreset(id)?.name ?? id}`);
		},
	});

	pi.registerCommand("rainbow-bundle", {
		description: "Apply a whole look at once: zen, crt, synthwave, matrix, inferno…",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const q = args.trim().toLowerCase();
			if (!q || q === "list") {
				const text = BUNDLES.map((b) => `  ${b.id.padEnd(11)} ${b.blurb}`).join("\n");
				c.ui.notify(`${BUNDLES.length} bundles\n${text}`, "info");
				return;
			}
			const bundle = getBundle(q);
			if (!bundle) {
				c.ui.notify(`Unknown bundle "${q}". Try /rainbow-bundle list`, "error");
				return;
			}
			apply(c, bundle.settings, `${bundle.name} — ${bundle.blurb}`);
		},
	});

	pi.registerCommand("rainbow-fx", {
		description: "Toggle or set an effect: <id> [0..1] | list | none",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const [name, value] = args.trim().split(/\s+/);
			const q = (name ?? "").toLowerCase();

			if (!q || q === "list") {
				const byGroup = new Map<string, string[]>();
				for (const f of allFx()) {
					const list = byGroup.get(f.group) ?? [];
					const on = (settings.fx[f.id] ?? 0) > 0;
					list.push(on ? `${f.id}*` : f.id);
					byGroup.set(f.group, list);
				}
				const text = [...byGroup.entries()]
					.map(([g, ids]) => `${g}: ${ids.join(", ")}`)
					.join("\n");
				c.ui.notify(`${allFx().length} effects (* = active)\n${text}`, "info");
				return;
			}

			if (q === "none" || q === "clear") {
				apply(c, { fx: {} }, "All effects off");
				return;
			}

			const layer = getFx(q);
			if (!layer) {
				c.ui.notify(`Unknown effect "${q}". Try /rainbow-fx list`, "error");
				return;
			}
			const fx = { ...settings.fx };
			if (value !== undefined && Number.isFinite(Number(value))) {
				const v = Math.max(0, Math.min(1, Number(value)));
				if (v === 0) delete fx[layer.id];
				else fx[layer.id] = v;
			} else if (fx[layer.id]) {
				delete fx[layer.id];
			} else {
				fx[layer.id] = layer.defaultIntensity;
			}
			apply(c, { fx }, `${layer.name}: ${fx[layer.id] ? `${fx[layer.id]!.toFixed(2)}` : "off"}`);
		},
	});

	pi.registerCommand("rainbow-mode", {
		description: "Gradient field: diagonal, radial, plasma, spiral, voronoi…",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const q = args.trim().toLowerCase();
			if (!q || q === "list") {
				c.ui.notify(
					`fields: ${GRADIENT_MODES.map((m) => m.id).join(", ")}\n` +
						`motion: ${MOTION_MODES.map((m) => m.id).join(", ")}`,
					"info",
				);
				return;
			}
			const field = GRADIENT_MODES.find((m) => m.id === q);
			const motion = MOTION_MODES.find((m) => m.id === q);
			if (field) apply(c, { mode: field.id as GradientMode }, `Field: ${field.id}`);
			else if (motion) apply(c, { motion: motion.id as MotionMode }, `Motion: ${motion.id}`);
			else c.ui.notify(`Unknown mode "${q}". Try /rainbow-mode list`, "error");
		},
	});

	pi.registerCommand("rainbow-scope", {
		description: "Where the colour lands: screen | panels | chrome | text",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const q = args.trim().toLowerCase();
			if (!q || q === "list") {
				const text = SCOPES.map(
					(s) => `  ${s.id === settings.scope ? "▸" : " "} ${s.id.padEnd(8)} ${s.blurb}`,
				).join("\n");
				c.ui.notify(`scope is "${settings.scope}"\n${text}`, "info");
				return;
			}
			const scope = SCOPES.find((s) => s.id === q);
			if (!scope) {
				c.ui.notify(`Unknown scope "${q}". Try /rainbow-scope list`, "error");
				return;
			}
			apply(c, { scope: scope.id }, `Scope: ${scope.id} — ${scope.blurb}`);
		},
	});

	pi.registerCommand("rainbow-speed", {
		description: "Set animation speed (palette cycles per second)",
		handler: async (args, ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const v = Number(args.trim());
			if (!Number.isFinite(v)) {
				c.ui.notify(`Speed is ${settings.speed}. Pass a number, e.g. /rainbow-speed 0.15`, "info");
				return;
			}
			apply(c, { speed: v }, `Speed: ${v}`);
		},
	});

	pi.registerCommand("rainbow-reset", {
		description: "Reset every rainbow setting to its default",
		handler: async (_args, ctx) => {
			await ensureLoaded();
			apply(ctx as unknown as AnyCtx, { ...DEFAULT_SETTINGS }, "Rainbow reset to defaults");
		},
	});

	pi.registerCommand("rainbow-splash", {
		description: "Show the rainbow splash overlay",
		handler: async (_args, ctx) => {
			await ensureLoaded();
			await showRainbowSplash(ctx, settings);
		},
	});

	/* ------------------------------------------------------------ *
	 * Shortcuts
	 * ------------------------------------------------------------ */

	pi.registerShortcut("ctrl+shift+r", {
		description: "Rainbow: next palette",
		handler: async (ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			const id = nextPresetId(settings.preset);
			apply(c, { preset: id }, `Palette: ${findPreset(id)?.name ?? id}`);
		},
	});

	pi.registerShortcut("ctrl+shift+e", {
		description: "Rainbow: toggle on/off",
		handler: async (ctx) => {
			await ensureLoaded();
			const c = ctx as unknown as AnyCtx;
			apply(c, { enabled: !settings.enabled }, `Rainbow ${settings.enabled ? "off" : "on"}`);
		},
	});
}
