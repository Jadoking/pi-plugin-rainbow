/**
 * The rainbow engine.
 *
 * Owns the clock, the palette crossfade, effect state, and the per-frame
 * pipeline that turns the TUI's screen lines into the thing you actually see.
 */

import {
	bandLightness,
	blendRamps,
	clamp01,
	ensureContrast,
	mixRgb,
	type Ramp,
	type RGB,
	sampleRamp,
	saturate,
	shade,
} from "./color.js";
import { type FieldState, fieldPhase, makeFieldState } from "./field.js";
import { buildFrame, effectiveBg, emitFrame, type Frame } from "./frame.js";
import { allFx, type FxContext, type FxEvent, type FxLayer, type FxTuning, makeRng } from "./fx.js";
import "./fx-particles.js";
import "./fx-post.js";
import { applyScope, boxBounds, isBoxCell, isChromeGlyph, type Layout, type RainbowScope } from "./layout.js";
import { presetIds, rampFor } from "./presets.js";
import type { RainbowSettings } from "./settings.js";

export type ProcessOptions = {
	width: number;
	height: number;
	/** Fullscreen (alt-screen) frames get the full treatment. */
	fullscreen: boolean;
	cursor?: { x: number; y: number } | null;
	overlayVisible?: boolean;
};

export type FrameStats = {
	lastMs: number;
	avgMs: number;
	frames: number;
	dropped: number;
	quality: number;
	cells: number;
};

const DEFAULT_BG: RGB = { r: 16, g: 17, b: 22 };
const DEFAULT_FG: RGB = { r: 215, g: 218, b: 226 };

/**
 * Glyphs exempt from the contrast floor: they are texture, not text.
 */
/**
 * Lightness band for structural rules, in OKLab terms.
 *
 * The floor is what stops a rule vanishing into a dark stretch of the palette;
 * the ceiling stops a pale palette turning a hairline into a glare line that
 * competes with the text above it.
 */
const RULE_L_MIN = 0.44;
const RULE_L_MAX = 0.82;

const DECOR_GLYPHS = new Set(
	" \u2591\u2592\u2593\u2588\u2580\u2584\u258c\u2590\u00b7\u2219\u2022\u25e6\u00b0\u22c5" +
		"\u2502\u2503\u2551\u258f\u258e\u258d\u258b\u258a\u2589" +
		"\u2500\u2501\u2550\u2504\u2505\u2508\u2509\u254c\u254d\u2581\u2594_",
);

export class RainbowEngine {
	private settings: RainbowSettings;
	private readonly t0 = Date.now();
	private lastFrameAt: number | null = null;
	private gradientPhase = 0;
	private store = new Map<string, unknown>();
	private events: FxEvent[] = [];
	private rng = makeRng(0x1f2e3d4c);
	private frameNo = 0;

	/** Palette crossfade state. */
	private rampFrom: Ramp;
	private rampTo: Ramp;
	private fadeStart = -1;

	/** 0..1 activity level. Decays toward 0. */
	private energy = 0;
	private lastActivity = 0;
	private presetCycledAt = 0;

	/** Adaptive quality: 1 = everything, lower = effects dropped. */
	private quality = 1;
	private stats: FrameStats = { lastMs: 0, avgMs: 0, frames: 0, dropped: 0, quality: 1, cells: 0 };

	bg: RGB = DEFAULT_BG;
	fg: RGB = DEFAULT_FG;

	constructor(settings: RainbowSettings) {
		this.settings = settings;
		this.rampFrom = rampFor(settings.preset);
		this.rampTo = this.rampFrom;
	}

	get now(): number {
		return (Date.now() - this.t0) / 1000;
	}

	getStats(): FrameStats {
		return { ...this.stats, quality: this.quality };
	}

	setTheme(bg: RGB | null, fg: RGB | null): void {
		if (bg) this.bg = bg;
		if (fg) this.fg = fg;
	}

	updateSettings(next: RainbowSettings): void {
		const prevPreset = this.settings.preset;
		this.settings = next;
		if (next.preset !== prevPreset) this.setPreset(next.preset);
	}

	/** Start a crossfade to a new palette. */
	setPreset(id: string): void {
		const target = rampFor(id);
		if (target === this.rampTo) return;
		this.rampFrom = this.currentRamp();
		this.rampTo = target;
		this.fadeStart = this.now;
	}

	/** A static renderer has no later frame to finish a palette crossfade. */
	settlePalette(): void {
		this.rampFrom = this.rampTo;
		this.fadeStart = -1;
	}

	private currentRamp(): Ramp {
		const fade = this.settings.presetFade;
		if (this.fadeStart < 0 || fade <= 0) return this.rampTo;
		const t = (this.now - this.fadeStart) / fade;
		if (t >= 1) {
			this.fadeStart = -1;
			return this.rampTo;
		}
		return blendRamps(this.rampFrom, this.rampTo, clamp01(t));
	}

	/** Tell the engine something happened (keystroke, tool call, error…). */
	pulse(amount = 0.5): void {
		this.energy = clamp01(Math.max(this.energy, amount));
		this.lastActivity = this.now;
	}

	emit(event: Omit<FxEvent, "t0">): void {
		this.events.push({ ...event, t0: this.now });
		if (this.events.length > 64) this.events.splice(0, this.events.length - 64);
		this.lastActivity = this.now;
	}

	/** True when something on screen still needs to move. */
	get idleSeconds(): number {
		return this.now - this.lastActivity;
	}

	resetState(): void {
		this.store.clear();
		this.events.length = 0;
		this.quality = 1;
	}

	/* ---------------------------------------------------------------- */

	private enabledLayers(): { layer: FxLayer; level: number }[] {
		const s = this.settings;
		const out: { layer: FxLayer; level: number }[] = [];
		for (const layer of allFx()) {
			const base = s.fx[layer.id];
			if (!base || base <= 0) continue;
			// Adaptive quality drops expensive effects first.
			if (this.quality < 1 && layer.cost >= 3 && this.quality < 0.7) continue;
			if (this.quality < 0.45 && layer.cost >= 2) continue;
			let level = base * s.chaos;
			if (s.reactive) level *= 1 + this.energy * 0.35;
			if (s.reducedMotion) level *= 0.5;
			out.push({ layer, level: clamp01(level) });
		}
		return out;
	}

	/** Which effects are active right now, for status lines and the dialog. */
	activeFxIds(): string[] {
		return this.enabledLayers().map((e) => e.layer.id);
	}

	/* ---------------------------------------------------------------- */

	process(lines: string[], opts: ProcessOptions): string[] {
		const s = this.settings;
		if (!s.enabled || lines.length === 0) return lines;

		const started = performance.now();
		const now = this.now;
		const elapsed = this.lastFrameAt === null ? 0 : Math.max(0, now - this.lastFrameAt);
		const dt = this.lastFrameAt === null ? 1 / 60 : Math.min(0.2, elapsed);
		this.lastFrameAt = now;
		this.frameNo++;

		// Energy decays unless something keeps poking it.
		const decay = Math.exp(-dt * 0.6);
		this.energy *= decay;

		// Optional automatic preset rotation.
		if (s.presetCycle > 0 && now - this.presetCycledAt > s.presetCycle) {
			this.presetCycledAt = now;
			this.cycleRandomPreset();
		}

		const width = Math.max(1, opts.width);
		const height = Math.max(1, opts.height);
		const padTo = s.fullBleed && opts.fullscreen;
		const frame = buildFrame(lines, width, height, padTo);
		frame.cursor = opts.cursor ?? null;

		const overlayVisible = Boolean(opts.overlayVisible);
		const calm = overlayVisible && s.calmOnOverlay;

		const speed = s.speed * (s.reactive ? 1 + this.energy * 1.2 : 1) * (s.reducedMotion ? 0.35 : 1);
		// Integrate speed per frame; changing it must not rescale the session's age.
		this.gradientPhase += elapsed * speed;
		const field: FieldState = makeFieldState({
			mode: s.mode,
			motion: s.reducedMotion && s.motion === "jitter" ? "scroll" : s.motion,
			width,
			height: frame.rows.length,
			time: now,
			turns: s.turns,
			speed,
			phase: this.gradientPhase,
			angle: s.angle,
			seed: 1337,
		});

		const ramp = this.currentRamp();
		const tuning: FxTuning = {
			ramp,
			field,
			bg: this.bg,
			fg: this.fg,
			energy: this.energy,
			chaos: s.chaos,
			overlayVisible,
			reducedMotion: s.reducedMotion,
		};

		// 0. Work out where pi's chrome is, and mute everything outside it when
		// the scope asks us to. Rows marked `skip` are passed through verbatim
		// by both the colouriser and every effect layer, so one flag is enough.
		const layout = applyScope(frame, s.scope);

		// 1. Base gradient colouring.
		this.colorize(frame, field, ramp, calm ? 0.45 : 1, layout, s.scope);

		// 2. Effect layers. In panels scope, prose gets only foreground colour;
		// particles and post-effects must not paint the space around it.
		{
			const effectsFrame = s.scope === "panels"
				? { ...frame, rows: frame.rows.map((row, y) => {
					if (!layout.rowBox[y]) return layout.rowRule[y] ? row : { ...row, skip: true };
					const bounds = boxBounds(row);
					const included = (col: number) => isBoxCell(row, col, bounds);
					return { ...row, cells: row.cells.filter((cell) => included(cell.col)),
						byCol: row.byCol.map((cell, col) => included(col) ? cell : undefined) };
				}) }
				: frame;
			const ctx: FxContext = {
				frame: effectsFrame,
				width,
				height: frame.rows.length,
				time: now,
				dt,
				frameNo: this.frameNo,
				cursor: frame.cursor,
				events: this.events,
				tuning,
				store: this.store,
				rnd: this.rng,
			};
			const layers = this.enabledLayers();
			for (const { layer, level } of layers) {
				try {
					layer.apply(ctx, calm ? level * 0.35 : level);
				} catch {
					// A broken effect must never take the terminal down with it.
				}
			}
			for (let y = 0; y < frame.rows.length; y++) {
				if (effectsFrame.rows[y]!.dirty) frame.rows[y]!.dirty = true;
			}
		}

		// 3. Legibility floor.
		//
		// This runs last on purpose. The colouriser can be made careful, but an
		// effect layer cannot: a particle or a post pass is free to drop any
		// colour it likes onto a cell, and several of them will happily bury
		// text. Enforcing the floor after every layer has had its turn means no
		// effect can render the screen unreadable, however it is configured.
		if (s.minContrast > 1) {
			this.enforceContrast(frame, s.minContrast);
		}

		// 4. Expire events.
		if (this.events.length) {
			this.events = this.events.filter((e) => now - e.t0 < 2.5);
		}

		const out = emitFrame(frame);

		// 5. Frame budget / adaptive quality.
		const ms = performance.now() - started;
		this.stats.lastMs = ms;
		this.stats.frames++;
		this.stats.cells = width * frame.rows.length;
		this.stats.avgMs = this.stats.avgMs === 0 ? ms : this.stats.avgMs * 0.9 + ms * 0.1;
		if (s.frameBudgetMs > 0) {
			if (ms > s.frameBudgetMs * 1.5) {
				this.quality = Math.max(0.3, this.quality - 0.12);
				this.stats.dropped++;
			} else if (ms < s.frameBudgetMs * 0.5 && this.quality < 1) {
				this.quality = Math.min(1, this.quality + 0.03);
			}
		} else {
			this.quality = 1;
		}

		return out;
	}

	private cycleRandomPreset(): void {
		const ids = presetIds();
		const next = ids[Math.floor(this.rng() * ids.length)] ?? this.settings.preset;
		this.settings = { ...this.settings, preset: next };
		this.setPreset(next);
	}

	/** Base pass: map every cell through the gradient field. */
	/**
	 * Final pass: guarantee every glyph clears the contrast floor.
	 *
	 * Only real glyphs are considered. Box-drawing characters, blocks and
	 * shading glyphs are decoration whose whole job is to be subtle, and
	 * forcing them to body-text contrast would turn a soft scanline into a
	 * hard stripe — it would destroy the effects in the name of readability.
	 */
	private enforceContrast(frame: Frame, min: number): void {
		for (const row of frame.rows) {
			if (row.skip) continue;
			for (const cell of row.cells) {
				if (cell.blank) continue;
				const ch = cell.outText ?? cell.text;
				if (!ch || !ch.trim() || DECOR_GLYPHS.has(ch)) continue;

				const bg = effectiveBg(cell, this.bg);
				const fg = cell.outFg ?? cell.fg ?? this.fg;
				const fixed = ensureContrast(fg, bg, min);
				if (fixed !== fg) {
					cell.outFg = fixed;
					row.dirty = true;
				}
			}
		}
	}

	private colorize(
		frame: Frame,
		field: FieldState,
		ramp: Ramp,
		scale: number,
		layout: Layout,
		scope: RainbowScope,
	): void {
		const s = this.settings;
		const blend = clamp01(s.blend * scale);
		const boxBlend = clamp01(s.boxBlend * scale);
		if ((blend <= 0 && boxBlend <= 0) || (!s.colorText && !s.colorBackground)) return;

		const vib = s.vibrance;
		const bright = s.brightness;
		// Backgrounds are a scope decision, not just a setting: `text` mode is
		// defined by never painting one, and `chrome` only ever hits glyphs.
		const allowBg = s.colorBackground && scope !== "text" && scope !== "chrome";

		for (let y = 0; y < frame.rows.length; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const isRule = layout.rowRule[y] === true;
			const bounds = boxBounds(row);

			const cells = row.cells;
			for (let i = 0; i < cells.length; i++) {
				const cell = cells[i]!;
				const inBox = layout.rowBox[y] === true && isBoxCell(row, cell.col, bounds);
				const backgroundBlend = inBox ? boxBlend : 0.17 * blend;
				const paintBg = allowBg && backgroundBlend > 0 && (scope !== "panels" || inBox);
				if (cell.style.inverse) continue;
				// `chrome` is a per-cell scope, not a per-row one: a rule with a
				// label in it should colour the rule and leave the label alone.
				if (scope === "chrome" && !isChromeGlyph(cell.outText)) continue;

				const phase = fieldPhase(field, cell.col, y);
				let col = sampleRamp(ramp, phase);
				if (vib !== 1) col = saturate(col, vib);
				if (bright !== 0) col = shade(col, bright);

				// Background: tint every cell that does not already carry its
				// own colour. Tinting only the empty cells leaves every word
				// sitting in an untinted dark box, which looks like a bug.
				if (paintBg && !isRule && cell.bgCode === null) {
					// Deliberately not on rules. A `\u2500` covers a sliver of its
					// cell, so tinting the rest turns a hairline into a solid
					// band and the gradient reads as a smear instead of a line.
					// The glyph already carries the ramp undiluted; let it.
					cell.outBg = mixRgb(this.bg, col, backgroundBlend);
					row.dirty = true;
				} else if (paintBg && inBox && !isRule) {
					cell.outBg = mixRgb(effectiveBg(cell, this.bg), col, backgroundBlend);
					row.dirty = true;
				}

				// Foreground: only cells that actually have ink.
				if (s.colorText && blend > 0 && !cell.blank) {
					const dimmed = s.preserveDim && cell.style.dim;
					// Separator rules are the clearest gradient carrier on the
					// screen, so give them the palette undiluted.
					// Inside a box pi has already colour-coded the text (command
					// vs output vs timing). Overriding that at full strength
					// throws away information, so the ramp only leans on it.
					const amount = isRule
						? 1
						: inBox
							? blend * 0.3
							: dimmed
								? blend * 0.4
								: blend;
					cell.outFg = mixRgb(cell.fg ?? this.fg, col, amount);
					if (isRule) {
						// Keep the line drawn along its whole length. Without
						// this the ramp's dark end erases whole stretches of the
						// rule and it reads as dashed rather than as a gradient.
						cell.outFg = bandLightness(cell.outFg, RULE_L_MIN, RULE_L_MAX);
						// No bold. It was compensating for rules disappearing
						// into dark palette stretches, which the lightness band
						// now handles properly; left on, it thickens a hairline
						// into something that competes with the text.
						cell.outBold = false;
					}
					row.dirty = true;
				}
			}
		}
	}
}
