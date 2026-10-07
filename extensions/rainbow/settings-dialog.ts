/**
 * The live settings dialog.
 *
 * Every change is applied to the running session the moment it is made, so the
 * embedded engine preview and the session update together; no apply step.
 */

import { Key, matchesKey, type OverlayOptions, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import { RainbowEngine } from "./engine.js";
import { type RGB, sampleRamp } from "./color.js";
import { GRADIENT_MODES, type GradientMode, MOTION_MODES, type MotionMode } from "./field.js";
import { allFx } from "./fx.js";
import { SCOPES } from "./layout.js";
import { findPreset, nextPresetId, presetIds, prevPresetId, rampFor } from "./presets.js";
import type { RainbowSettings } from "./settings.js";

type Theme = { fg: (role: string, text: string) => string; bold: (text: string) => string };

type DialogCtx = {
	ui: {
		custom: <T>(
			factory: (
				tui: { requestRender: () => void; terminal?: { rows: number } },
				theme: Theme,
				keybindings: unknown,
				done: (result: T) => void,
			) => {
				render: (width: number) => string[];
				handleInput?: (data: string) => void;
				invalidate?: () => void;
				dispose?: () => void;
			},
			options?: { overlay?: boolean; overlayOptions?: OverlayOptions },
		) => Promise<T>;
	};
};

const DIALOG_WIDTH = 72;
const DIALOG_HEIGHT = 24;
const RESET = "\u001b[0m";
const ink = (c: RGB, s: string) => `\u001b[38;2;${c.r};${c.g};${c.b}m${s}${RESET}`;

type Row =
	| { kind: "header"; label: string }
	| {
			kind: "field";
			label: string;
			/** Rendered to the right of the label. */
			read: (s: RainbowSettings, theme: Theme) => string;
			/** dir is -1 or +1; returns the patch to apply, or {} for a no-op. */
			step: (s: RainbowSettings, dir: number) => Partial<RainbowSettings>;
			hint: string;
			toggle?: (s: RainbowSettings) => Partial<RainbowSettings>;
	  };

/** Clamp and round, so repeated steps never drift into float noise. */
const num = (v: number, lo: number, hi: number, places = 2): number => {
	const p = 10 ** places;
	return Math.round(Math.min(hi, Math.max(lo, v)) * p) / p;
};

function cycle<T>(list: readonly T[], current: T, dir: number): T {
	const i = list.indexOf(current);
	const n = list.length;
	return list[((i < 0 ? 0 : i) + dir + n) % n]!;
}

function slider(theme: Theme, value: number, lo: number, hi: number, width = 10): string {
	const t = hi === lo ? 0 : (value - lo) / (hi - lo);
	const filled = Math.round(Math.min(1, Math.max(0, t)) * width);
	return theme.fg("dim", "━".repeat(filled) + "·".repeat(width - filled));
}

function rampBar(preset: string, cells: number): string {
	const ramp = rampFor(preset);
	let out = "";
	for (let i = 0; i < cells; i++) out += ink(sampleRamp(ramp, i / cells), "█");
	return out;
}

function buildRows(): Row[] {
	const gradientIds = GRADIENT_MODES.map((m) => m.id as GradientMode);
	const motionIds = MOTION_MODES.map((m) => m.id as MotionMode);
	const scopeIds = SCOPES.map((s) => s.id);
	const fxRows: Row[] = allFx().map((fx) => {
		const patch = (s: RainbowSettings, level: number): Partial<RainbowSettings> => {
			const next = { ...s.fx };
			if (level <= 0) delete next[fx.id];
			else next[fx.id] = level;
			return { fx: next };
		};
		return {
			kind: "field", label: fx.id,
			read: (s, t) => `${slider(t, s.fx[fx.id] ?? 0, 0, 1)} ${(s.fx[fx.id] ?? 0).toFixed(2)}`,
			step: (s, d) => patch(s, num((s.fx[fx.id] ?? 0) + d * 0.05, 0, 1)),
			toggle: (s) => patch(s, s.fx[fx.id] > 0 ? 0 : fx.defaultIntensity),
			hint: `${fx.name}: ${fx.blurb}`,
		};
	});

	return [
		{ kind: "header", label: "what and where" },
		{
			kind: "field",
			label: "enabled",
			read: (s, t) => (s.enabled ? t.fg("success", "on") : t.fg("muted", "off")),
			step: (s) => ({ enabled: !s.enabled }),
			hint: "master switch",
		},
		{
			kind: "field",
			label: "scope",
			read: (s) => s.scope,
			step: (s, d) => ({ scope: cycle(scopeIds, s.scope, d) }),
			hint: "where the colour lands",
		},
		{
			kind: "field",
			label: "palette",
			read: (s, t) => {
				const p = findPreset(s.preset);
				const n = presetIds().indexOf(p?.id ?? s.preset) + 1;
				return `${rampBar(s.preset, 14)} ${p?.name ?? s.preset} ${t.fg("dim", `${n}/${presetIds().length}`)}`;
			},
			step: (s, d) => ({ preset: d > 0 ? nextPresetId(s.preset) : prevPresetId(s.preset) }),
			hint: "colour ramp",
		},

		{ kind: "header", label: "gradient" },
		{
			kind: "field",
			label: "field",
			read: (s) => s.mode,
			step: (s, d) => ({ mode: cycle(gradientIds, s.mode, d) }),
			hint: `${gradientIds.length} gradient shapes`,
		},
		{
			kind: "field",
			label: "motion",
			read: (s) => s.motion,
			step: (s, d) => ({ motion: cycle(motionIds, s.motion, d) }),
			hint: `${motionIds.length} ways to move`,
		},
		{
			kind: "field",
			label: "speed",
			read: (s, t) => `${slider(t, s.speed, 0, 1)} ${s.speed.toFixed(2)}`,
			step: (s, d) => ({ speed: num(s.speed + d * 0.02, 0, 1) }),
			hint: "palette cycles per second",
		},
		{
			kind: "field",
			label: "turns",
			read: (s, t) => `${slider(t, s.turns, 0.25, 8)} ${s.turns.toFixed(2)}`,
			step: (s, d) => ({ turns: num(s.turns + d * 0.25, 0.25, 8) }),
			hint: "bands across the screen",
		},
		{
			kind: "field",
			label: "angle",
			read: (s, t) => `${slider(t, s.angle, 0, 359)} ${Math.round(s.angle)}°`,
			step: (s, d) => ({ angle: num((s.angle + d * 15 + 360) % 360, 0, 359, 0) }),
			hint: "gradient rotation",
		},

		{ kind: "header", label: "colour" },
		{
			kind: "field",
			label: "text blend",
			read: (s, t) => `${slider(t, s.blend, 0, 1)} ${s.blend.toFixed(2)}`,
			step: (s, d) => ({ blend: num(s.blend + d * 0.05, 0, 1) }),
			hint: "how far from the original colours",
		},
		{
			kind: "field",
			label: "box strength",
			read: (s, t) => `${slider(t, s.boxBlend, 0, 1)} ${Math.round(s.boxBlend * 100)}%`,
			step: (s, d) => ({ boxBlend: num(s.boxBlend + d * 0.05, 0, 1) }),
			hint: "box fill: 0% original, 100% palette; effects still apply",
		},
		{
			kind: "field",
			label: "vibrance",
			read: (s, t) => `${slider(t, s.vibrance, 0, 2)} ${s.vibrance.toFixed(2)}`,
			step: (s, d) => ({ vibrance: num(s.vibrance + d * 0.05, 0, 2) }),
			hint: "chroma multiplier",
		},
		{
			kind: "field",
			label: "brightness",
			read: (s, t) => `${slider(t, s.brightness, -1, 1)} ${s.brightness.toFixed(2)}`,
			step: (s, d) => ({ brightness: num(s.brightness + d * 0.05, -1, 1) }),
			hint: "lightness shift",
		},
		{
			kind: "field",
			label: "text",
			read: (s, t) => (s.colorText ? t.fg("success", "on") : t.fg("muted", "off")),
			step: (s) => ({ colorText: !s.colorText }),
			hint: "colour glyphs",
		},
		{
			kind: "field",
			label: "background",
			read: (s, t) => (s.colorBackground ? t.fg("success", "on") : t.fg("muted", "off")),
			step: (s) => ({ colorBackground: !s.colorBackground }),
			hint: "tint cell backgrounds",
		},

		{ kind: "header", label: "effects" },
		...fxRows,
		{ kind: "header", label: "budget" },
		{
			kind: "field",
			label: "chaos",
			read: (s, t) => `${slider(t, s.chaos, 0, 1)} ${s.chaos.toFixed(2)}`,
			step: (s, d) => ({ chaos: num(s.chaos + d * 0.05, 0, 1) }),
			hint: "effect intensity multiplier",
		},
		{
			kind: "field",
			label: "fps",
			read: (s, t) => `${slider(t, s.fps, 1, 60)} ${s.fps}`,
			step: (s, d) => ({ fps: num(s.fps + d * 2, 1, 60, 0) }),
			hint: "animation rate",
		},
		{
			kind: "field",
			label: "reduced motion",
			read: (s, t) => (s.reducedMotion ? t.fg("success", "on") : t.fg("muted", "off")),
			step: (s) => ({ reducedMotion: !s.reducedMotion }),
			hint: "calm everything down",
		},
		{
			kind: "field",
			label: "footer status",
			read: (s, t) => (s.showStatus ? t.fg("success", "on") : t.fg("muted", "off")),
			step: (s) => ({ showStatus: !s.showStatus }),
			hint: "show state in pi's footer",
		},
	];
}

/** A miniature transcript: filled tool panel, outlined side box, and prose. */
function previewLines(width: number): string[] {
	const side = Math.max(3, Math.floor((width - 2) / 2));
	const fill = (text: string) => `\x1b[48;2;28;30;38m${truncateToWidth(text, side).padEnd(side)}${RESET}`;
	const edge = "─".repeat(Math.max(1, side - 2));
	const inside = (text: string) => `│${truncateToWidth(text, side - 2).padEnd(side - 2)}│`;
	return [
		fill(" Filled tool") + `  ╭${edge}╮`,
		fill(" npm run build") + "  " + inside(" Outline"),
		fill(" complete") + `  ╰${edge}╯`,
		"Assistant text · live engine preview",
	].map((line) => truncateToWidth(line, width));
}

export async function showRainbowSettingsDialog(
	ctx: unknown,
	initial: RainbowSettings,
	onChange: (patch: Partial<RainbowSettings>) => void,
): Promise<void> {
	const c = ctx as DialogCtx;
	if (typeof c?.ui?.custom !== "function") return;

	const rows = buildRows();
	const fieldIdx = rows.map((r, i) => (r.kind === "field" ? i : -1)).filter((i) => i >= 0);
	let cursor = fieldIdx[0] ?? 0;
	let current: RainbowSettings = { ...initial, fx: { ...initial.fx } };
	let cleanup = () => {};
	try {
		await c.ui.custom<void>(
			(tui, theme, _kb, done) => {
				let closed = false;
				let scroll = 0;
				let previewWidth = 60;
				const engine = new RainbowEngine(current);
				let timer: ReturnType<typeof setInterval> | undefined;
				cleanup = () => {
					closed = true;
					if (timer !== undefined) clearInterval(timer);
					timer = undefined;
				};
				const startTimer = () => {
					if (timer !== undefined) clearInterval(timer);
					const fps = current.reducedMotion ? Math.min(12, current.fps) : current.fps;
					timer = setInterval(() => {
						if (!closed) tui.requestRender();
					}, 1000 / Math.max(1, fps));
				};
				startTimer();
				const close = () => {
					if (closed) return;
					cleanup();
					done();
				};

				const move = (dir: number) => {
					const at = fieldIdx.indexOf(cursor);
					const next = fieldIdx[(at + dir + fieldIdx.length) % fieldIdx.length];
					if (next !== undefined) cursor = next;
					tui.requestRender();
				};

				const adjust = (dir: number, toggle = false) => {
					const row = rows[cursor];
					if (!row || row.kind !== "field") return;
					const patch = toggle && row.toggle ? row.toggle(current) : row.step(current, dir);
					engine.pulse(0.6);
					for (const kind of ["ripple", "shockwave", "flash", "burst"] as const) {
						engine.emit({ kind, x: Math.floor(previewWidth / 4), y: 2, strength: 0.6 });
					}
					if (Object.keys(patch).length === 0) return;
					current = { ...current, ...patch };
					engine.updateSettings(current);
					if (patch.fps !== undefined || patch.reducedMotion !== undefined) startTimer();
					onChange(patch);
					tui.requestRender();
				};

				return {
					invalidate() {},

					render(width: number): string[] {
						const inner = Math.max(0, Math.min(width, DIALOG_WIDTH) - 2);
						const height = Math.max(1, Math.min(DIALOG_HEIGHT, (tui.terminal?.rows ?? process.stdout.rows ?? 24) - 2));
						previewWidth = Math.max(1, inner - 2);
						const preview = height >= 15 ? previewLines(Math.max(1, inner - 2)) : [];
						const slots = Math.max(1, height - preview.length - 5);
						scroll = Math.max(0, Math.min(scroll, cursor, rows.length - slots));
						if (cursor >= scroll + slots) scroll = cursor - slots + 1;
						const out: string[] = [];
						const border = (s: string) => theme.fg("border", s);
						const line = (content = "") => {
							content = truncateToWidth(content, inner);
							const padding = Math.max(0, inner - visibleWidth(content));
							out.push(`${border("│")}${content}${" ".repeat(padding)}${border("│")}`);
						};

						out.push(border(`╭${"─".repeat(inner)}╮`));
						line(` ${theme.bold(theme.fg("accent", "rainbow"))} ${theme.fg("muted", `· live · ${fieldIdx.indexOf(cursor) + 1}/${fieldIdx.length}`)}`);
						if (preview.length) {
							for (const row of engine.process(preview, {
								width: Math.max(1, inner - 2), height: preview.length, fullscreen: true,
							})) line(` ${row}`);
						}

						for (let i = scroll; i < Math.min(rows.length, scroll + slots); i++) {
							const row = rows[i]!;
							if (row.kind === "header") {
								line(` ${theme.fg("dim", row.label)}`);
								continue;
							}
							const on = i === cursor;
							const marker = on ? theme.fg("accent", "▸") : " ";
							const label = on
								? theme.fg("accent", row.label.padEnd(15))
								: theme.fg("text", row.label.padEnd(15));
							const value = row.read(current, theme);
							const left = ` ${marker} ${label} ${value}`;
							line(left);
						}

						const selected = rows[cursor];
						line(` ${theme.fg("muted", selected?.kind === "field" ? selected.hint : "")}`);
						line(
							` ${theme.fg("dim", "↑↓ field  ←→ adjust  space toggle  PgUp/Dn  r reset  esc close")}`,
						);
						out.push(border(`╰${"─".repeat(inner)}╯`));

						return out.slice(0, height).map((l) => truncateToWidth(l, width));
					},

					handleInput(data: string) {
						if (closed) return;
						if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
							close();
							return;
						}
						if (matchesKey(data, Key.pageUp)) return move(-8);
						if (matchesKey(data, Key.pageDown)) return move(8);
						if (matchesKey(data, Key.up)) return move(-1);
						if (matchesKey(data, Key.down)) return move(1);
						if (matchesKey(data, Key.left)) return adjust(-1);
						if (matchesKey(data, Key.right)) return adjust(1);
						if (matchesKey(data, Key.space)) return adjust(1, true);
						if (data.toLowerCase() === "r") {
							// Restore opening values for the adjustable controls, including FX.
							const patch: Partial<RainbowSettings> = {
								fx: { ...initial.fx },
								scope: initial.scope,
								preset: initial.preset,
								mode: initial.mode,
								motion: initial.motion,
								speed: initial.speed,
								turns: initial.turns,
								angle: initial.angle,
								blend: initial.blend,
								boxBlend: initial.boxBlend,
								vibrance: initial.vibrance,
								brightness: initial.brightness,
								chaos: initial.chaos,
								fps: initial.fps,
							};
							current = { ...current, ...patch };
							engine.updateSettings(current);
							if (patch.fps !== undefined || patch.reducedMotion !== undefined) startTimer();
							onChange(patch);
							tui.requestRender();
						}
					},

					dispose: cleanup,
				};
			},
			{ overlay: true, overlayOptions: { width: DIALOG_WIDTH, margin: 1 } },
		);
	} finally {
		cleanup();
	}
}
