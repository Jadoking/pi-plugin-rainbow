/**
 * FX framework: shared types, the layer registry, and drawing helpers.
 *
 * A layer is a pure-ish function over a `Frame`. Layers run in a fixed order
 * (`FX_ORDER`) so that, for example, bloom sees the particles that were drawn
 * before it and the vignette darkens everything.
 */

import type { RGB } from "./color.js";
import type { FieldState } from "./field.js";
import type { Frame, FrameCell, FrameRow } from "./frame.js";
import type { Ramp } from "./color.js";

export type FxGroup = "field" | "particles" | "post" | "reactive";

/** Transient things the engine wants effects to react to. */
export type FxEvent = {
	kind: "ripple" | "shockwave" | "flash" | "burst";
	/** Column / row origin, in cells. */
	x: number;
	y: number;
	/** Engine time when it fired. */
	t0: number;
	strength: number;
	color?: RGB;
};

export type FxTuning = {
	/** Palette ramp currently in use. */
	ramp: Ramp;
	/** Precomputed gradient field for this frame. */
	field: FieldState;
	/** Best guess at the terminal background. */
	bg: RGB;
	/** Best guess at the terminal foreground. */
	fg: RGB;
	/** 0 = idle, 1 = agent working flat out. Effects use it to ramp up. */
	energy: number;
	/** Master multiplier applied on top of every per-effect intensity. */
	chaos: number;
	/** Set when an overlay (dialog) is on screen — effects calm down. */
	overlayVisible: boolean;
	/** User asked for reduced motion / low power. */
	reducedMotion: boolean;
};

export type FxContext = {
	frame: Frame;
	width: number;
	height: number;
	/** Seconds since the engine started. */
	time: number;
	/** Seconds since the previous rendered frame (clamped). */
	dt: number;
	frameNo: number;
	cursor: { x: number; y: number } | null;
	events: FxEvent[];
	tuning: FxTuning;
	/** Per-effect persistent storage, keyed by effect id. */
	store: Map<string, unknown>;
	/** Deterministic PRNG, re-seeded each session (not each frame). */
	rnd: () => number;
};

export type FxLayer = {
	id: string;
	name: string;
	group: FxGroup;
	blurb: string;
	/** 0..1. Used when the effect is enabled without an explicit level. */
	defaultIntensity: number;
	/** Rough cost hint, for the auto-degrade budget. 1 = cheap, 3 = expensive. */
	cost: 1 | 2 | 3;
	/** Effects in the same slot are mutually exclusive in `/rainbow-fx only`. */
	apply: (ctx: FxContext, intensity: number) => void;
};

/* ------------------------------------------------------------------ *
 * Drawing helpers
 * ------------------------------------------------------------------ */

/** Paint a glyph into a cell, taking ownership so later particle layers skip it. */
export function draw(
	row: FrameRow,
	cell: FrameCell | undefined,
	ch: string,
	fg: RGB | null,
	bg?: RGB | null,
): boolean {
	// `quiet` rows take the gradient but no effects: a one-line editor or a
	// footer is too thin for particles, which read as noise rather than weather.
	if (!cell || cell.claimed || row.quiet) return false;
	if (ch.length > 0 && cell.width === 1) cell.outText = ch;
	if (fg !== undefined) cell.outFg = fg;
	if (bg !== undefined) cell.outBg = bg;
	cell.claimed = true;
	row.dirty = true;
	return true;
}

/** Paint into whitespace without replacing text or box borders. */
export function drawIfBlank(
	row: FrameRow,
	cell: FrameCell | undefined,
	ch: string,
	fg: RGB | null,
	bg?: RGB | null,
): boolean {
	if (!cell || !cell.blank || cell.claimed) return false;
	return draw(row, cell, ch, fg, bg);
}

/** Iterate every non-skipped row. */
export function forEachRow(frame: Frame, fn: (row: FrameRow, y: number) => void): void {
	for (let y = 0; y < frame.rows.length; y++) {
		const row = frame.rows[y]!;
		if (row.skip) continue;
		fn(row, y);
	}
}

/** Iterate every cell exactly once (wide glyphs visited once, at their start column). */
export function forEachCell(frame: Frame, fn: (cell: FrameCell, row: FrameRow, x: number, y: number) => void): void {
	for (let y = 0; y < frame.rows.length; y++) {
		const row = frame.rows[y]!;
		if (row.skip) continue;
		const cells = row.cells;
		for (let i = 0; i < cells.length; i++) {
			const cell = cells[i]!;
			fn(cell, row, cell.col, y);
		}
	}
}

/** Mulberry32 — tiny, fast, seedable. */
export function makeRng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Get-or-create persistent per-effect state. */
export function slot<T>(ctx: FxContext, id: string, init: () => T): T {
	let v = ctx.store.get(id) as T | undefined;
	if (v === undefined) {
		v = init();
		ctx.store.set(id, v);
	}
	return v;
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

const registry = new Map<string, FxLayer>();

export function registerFx(...layers: FxLayer[]): void {
	for (const l of layers) registry.set(l.id, l);
}

export function getFx(id: string): FxLayer | undefined {
	return registry.get(id);
}

export function allFx(): FxLayer[] {
	return FX_ORDER.map((id) => registry.get(id)).filter((l): l is FxLayer => Boolean(l));
}

export function fxIds(): string[] {
	return allFx().map((l) => l.id);
}

/**
 * Execution order. Background fills first, particles next, post filters last —
 * bloom and vignette need to see everything that came before.
 */
export const FX_ORDER: string[] = [
	// background fills
	"plasmafield",
	"gridfloor",
	"aurora",
	"starfield",
	"tunnelrings",
	"fire",
	// falling / moving particles
	"matrix",
	"rain",
	"snow",
	"sakura",
	"bubbles",
	"fireflies",
	"confetti",
	"comet",
	"waveform",
	"ripples",
	// text treatments
	"neon",
	"shadow",
	"heat",
	"typewriter",
	// global light
	"shine",
	"spotlight",
	"lightning",
	"breathing",
	// distortion
	"wobble",
	"glitch",
	"aberration",
	"strobe",
	"interlace",
	// final filters
	"bloom",
	"scanlines",
	"vignette",
	"dither",
	"noisegrain",
];
