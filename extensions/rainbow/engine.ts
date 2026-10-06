/**
 * The rainbow engine.
 *
 * Owns the clock, the palette crossfade, effect state, and the per-frame
 * pipeline that turns the TUI's screen lines into the thing you actually see.
 */

import { blendRamps, clamp01, mixRgb, type Ramp, type RGB, sampleRamp, saturate, shade } from "./color.js";
import { type FieldState, fieldPhase, makeFieldState } from "./field.js";
import { buildFrame, effectiveBg, emitFrame, type Frame } from "./frame.js";
import { allFx, type FxContext, type FxEvent, type FxLayer, type FxTuning, makeRng } from "./fx.js";
import "./fx-particles.js";
import "./fx-post.js";
import { applyScope, isChromeGlyph, type Layout, type RainbowScope } from "./layout.js";
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

export class RainbowEngine {
	private settings: RainbowSettings;
	private readonly t0 = Date.now();
	private lastFrameAt = 0;
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
		const dt = this.lastFrameAt === 0 ? 1 / 60 : Math.min(0.2, Math.max(0.001, now - this.lastFrameAt));
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
		const field: FieldState = makeFieldState({
			mode: s.mode,
			motion: s.reducedMotion && s.motion === "jitter" ? "scroll" : s.motion,
			width,
			height: frame.rows.length,
			time: now,
			turns: s.turns,
			speed,
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

		// 2. Effect layers.
		{
			const ctx: FxContext = {
				frame,
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
		}

		// 3. Expire events.
		if (this.events.length) {
			this.events = this.events.filter((e) => now - e.t0 < 2.5);
		}

		const out = emitFrame(frame);

		// 4. Frame budget / adaptive quality.
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
		if (blend <= 0 || (!s.colorText && !s.colorBackground)) return;

		const vib = s.vibrance;
		const bright = s.brightness;
		// Backgrounds are a scope decision, not just a setting: `text` mode is
		// defined by never painting one, and `chrome` only ever hits glyphs.
		const paintBg = s.colorBackground && scope !== "text" && scope !== "chrome";

		for (let y = 0; y < frame.rows.length; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const isRule = layout.rowRule[y] === true;
			const inBox = layout.rowBox[y] === true;
			const cells = row.cells;
			for (let i = 0; i < cells.length; i++) {
				const cell = cells[i]!;
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
				if (paintBg && cell.bgCode === null) {
					cell.outBg = mixRgb(this.bg, col, 0.17 * blend);
					row.dirty = true;
				} else if (paintBg && inBox) {
					// pi fills tool calls and messages with a flat theme colour.
					// Leaving those alone was what made the rainbow look like it
					// stopped at the edge of every box; pulling them towards the
					// ramp is what makes a block read as part of the gradient.
					cell.outBg = mixRgb(effectiveBg(cell, this.bg), col, 0.38 * blend);
					row.dirty = true;
				}

				// Foreground: only cells that actually have ink.
				if (s.colorText && !cell.blank) {
					const dimmed = s.preserveDim && cell.style.dim;
					// Separator rules are the clearest gradient carrier on the
					// screen, so give them the palette undiluted.
					const amount = isRule ? 1 : dimmed ? blend * 0.4 : blend;
					cell.outFg = mixRgb(cell.fg ?? this.fg, col, amount);
					if (isRule) cell.outBold = true;
					row.dirty = true;
				}
			}
		}
	}
}
