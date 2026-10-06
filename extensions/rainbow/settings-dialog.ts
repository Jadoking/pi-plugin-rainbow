/**
 * The live settings dialog.
 *
 * Every change is applied to the running session the moment it is made, so the
 * screen behind the overlay is the preview: there is no "apply" step, and no
 * way to be looking at a setting that is not actually in effect.
 */

import { Key, matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

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
				tui: { requestRender: () => void },
				theme: Theme,
				keybindings: unknown,
				done: (result: T) => void,
			) => {
				render: (width: number) => string[];
				handleInput?: (data: string) => void;
				invalidate?: () => void;
				dispose?: () => void;
			},
			options?: { overlay?: boolean },
		) => Promise<T>;
	};
};

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
	const fxCount = allFx().length;

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
			label: "blend",
			read: (s, t) => `${slider(t, s.blend, 0, 1)} ${s.blend.toFixed(2)}`,
			step: (s, d) => ({ blend: num(s.blend + d * 0.05, 0, 1) }),
			hint: "how far from the original colours",
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

		{ kind: "header", label: "effects and budget" },
		{
			kind: "field",
			label: "effects",
			read: (s, t) => {
				const on = Object.entries(s.fx)
					.filter(([, v]) => v > 0)
					.map(([k]) => k);
				if (!on.length) return t.fg("muted", `none of ${fxCount}`);
				const shown = on.slice(0, 4).join(" ");
				return `${shown}${on.length > 4 ? t.fg("dim", ` +${on.length - 4}`) : ""}`;
			},
			step: () => ({}),
			hint: "set with /rainbow-fx",
		},
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
	let current: RainbowSettings = { ...initial };

	await c.ui.custom<void>(
		(tui, theme, _kb, done) => {
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				done();
			};

			const move = (dir: number) => {
				const at = fieldIdx.indexOf(cursor);
				const next = fieldIdx[(at + dir + fieldIdx.length) % fieldIdx.length];
				if (next !== undefined) cursor = next;
				tui.requestRender();
			};

			const adjust = (dir: number) => {
				const row = rows[cursor];
				if (!row || row.kind !== "field") return;
				const patch = row.step(current, dir);
				if (Object.keys(patch).length === 0) return;
				current = { ...current, ...patch };
				onChange(patch);
				tui.requestRender();
			};

			return {
				invalidate() {},

				render(width: number): string[] {
					const inner = Math.max(40, Math.min(width, 88) - 2);
					const out: string[] = [];
					const border = (s: string) => theme.fg("border", s);
					const line = (content = "") => {
						const padding = Math.max(0, inner - visibleWidth(content));
						out.push(`${border("│")}${content}${" ".repeat(padding)}${border("│")}`);
					};

					out.push(border(`╭${"─".repeat(inner)}╮`));
					line(` ${theme.bold(theme.fg("accent", "rainbow"))} ${theme.fg("muted", "— changes apply live")}`);
					line(` ${rampBar(current.preset, inner - 2)}`);
					line();

					for (let i = 0; i < rows.length; i++) {
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
						const hint = on ? theme.fg("muted", row.hint) : "";
						const gap = Math.max(1, inner - visibleWidth(left) - visibleWidth(hint) - 1);
						line(`${left}${" ".repeat(gap)}${hint} `);
					}

					line();
					line(
						` ${theme.fg("dim", "↑↓ field   ←→ adjust   space toggle   r reset   esc close")}`,
					);
					out.push(border(`╰${"─".repeat(inner)}╯`));

					return out.map((l) => truncateToWidth(l, width));
				},

				handleInput(data: string) {
					if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
						close();
						return;
					}
					if (matchesKey(data, Key.up)) return move(-1);
					if (matchesKey(data, Key.down)) return move(1);
					if (matchesKey(data, Key.left)) return adjust(-1);
					if (matchesKey(data, Key.right) || matchesKey(data, Key.space)) return adjust(1);
					if (data.toLowerCase() === "r") {
						// Reset only touches what this dialog edits; effects are
						// owned by /rainbow-fx and should survive.
						const patch: Partial<RainbowSettings> = {
							scope: initial.scope,
							preset: initial.preset,
							mode: initial.mode,
							motion: initial.motion,
							speed: initial.speed,
							turns: initial.turns,
							angle: initial.angle,
							blend: initial.blend,
							vibrance: initial.vibrance,
							brightness: initial.brightness,
							chaos: initial.chaos,
							fps: initial.fps,
						};
						current = { ...current, ...patch };
						onChange(patch);
						tui.requestRender();
					}
				},

				dispose: close,
			};
		},
		{ overlay: true },
	);
}
