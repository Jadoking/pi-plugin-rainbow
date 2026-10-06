/**
 * Post-processing and light effects.
 *
 * These run after the particle layers and treat the frame as an image: they
 * brighten, dim, smear, quantise and corrupt what is already there.
 */

import {
	ANSI16,
	BAYER4,
	clamp01,
	grayscale,
	invert as invertRgb,
	lightness,
	mixRgb,
	nearestFrom,
	type RGB,
	rotateHue,
	sampleRamp,
	scaleLightness,
	screenBlend,
	shade,
} from "./color.js";
import { bump, hash2, triangle, valueNoise } from "./field.js";
import type { Frame, FrameCell, FrameRow } from "./frame.js";
import { draw, type FxContext, type FxLayer, registerFx, slot } from "./fx.js";

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

function eachCell(frame: Frame, fn: (cell: FrameCell, row: FrameRow, x: number, y: number) => void): void {
	for (let y = 0; y < frame.rows.length; y++) {
		const row = frame.rows[y]!;
		if (row.skip || row.quiet) continue;
		const cells = row.cells;
		for (let i = 0; i < cells.length; i++) fn(cells[i]!, row, cells[i]!.col, y);
	}
}

/** True when the cell carries visible text (not a blank/particle backdrop). */
const isText = (c: FrameCell): boolean => !c.blank && c.outText.trim().length > 0;

/* ================================================================== *
 * neon — make text glow
 * ================================================================== */

const neon: FxLayer = {
	id: "neon",
	name: "Neon Sign",
	group: "post",
	blurb: "text gets a hot core and a coloured halo behind it",
	defaultIntensity: 0.5,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning } = ctx;
		eachCell(frame, (cell, row) => {
			if (!isText(cell)) return;
			const base = cell.outFg ?? tuning.fg;
			cell.outFg = screenBlend(base, scaleLightness(base, 0.55 * k));
			cell.outBold = cell.outBold || k > 0.55;
			// A halo, not a highlighter pen: text cells keep a near-black
			// background or the whole screen turns into labelled boxes.
			const halo = scaleLightness(base, 0.09 * k);
			cell.outBg = cell.outBg ? screenBlend(cell.outBg, halo) : mixRgb(tuning.bg, halo, 0.35);
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * shadow — offset drop shadow in the blank cell below-right
 * ================================================================== */

const shadow: FxLayer = {
	id: "shadow",
	name: "Drop Shadow",
	group: "post",
	blurb: "a dim ghost of every glyph, one cell down and right",
	defaultIntensity: 0.45,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning } = ctx;
		// Collect first; writing while iterating would shadow the shadows.
		const writes: { row: FrameRow; cell: FrameCell; ch: string; col: RGB }[] = [];
		eachCell(frame, (cell, _row, x, y) => {
			if (!isText(cell) || cell.width !== 1) return;
			const target = frame.rows[y + 1];
			if (!target || target.skip) return;
			const dst = target.byCol[x + 1];
			if (!dst || !dst.blank || dst.claimed) return;
			const src = cell.outFg ?? tuning.fg;
			writes.push({ row: target, cell: dst, ch: cell.outText, col: mixRgb(tuning.bg, src, 0.22 * k) });
		});
		for (const w of writes) draw(w.row, w.cell, w.ch, w.col);
	},
};

/* ================================================================== *
 * heat — cells that changed recently glow, then cool off
 * ================================================================== */

type HeatState = { prev: string[]; heat: Float32Array; w: number; h: number };

const heat: FxLayer = {
	id: "heat",
	name: "Heat Trail",
	group: "reactive",
	blurb: "anything that just changed on screen glows hot, then cools",
	defaultIntensity: 0.65,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const st = slot<HeatState>(ctx, "heat", () => ({
			prev: new Array(width * rows).fill(""),
			heat: new Float32Array(width * rows),
			w: width,
			h: rows,
		}));
		if (st.w !== width || st.h !== rows) {
			st.prev = new Array(width * rows).fill("");
			st.heat = new Float32Array(width * rows);
			st.w = width;
			st.h = rows;
		}

		const cool = Math.exp(-ctx.dt * 2.2);
		for (let i = 0; i < st.heat.length; i++) st.heat[i] = st.heat[i]! * cool;

		eachCell(frame, (cell, row, x, y) => {
			const idx = y * width + x;
			if (idx < 0 || idx >= st.prev.length) return;
			const sig = cell.text;
			if (st.prev[idx] !== sig) {
				st.prev[idx] = sig;
				if (sig.trim().length > 0) st.heat[idx] = 1;
			}
			const h = st.heat[idx]!;
			if (h < 0.03) return;
			const hot = sampleRamp(tuning.ramp, 0.02 + (1 - h) * 0.25);
			cell.outFg = mixRgb(cell.outFg ?? tuning.fg, screenBlend(hot, rgb(90, 70, 40)), clamp01(h * k));
			if (h > 0.55) cell.outBold = true;
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * typewriter — underline the row that is actively changing
 * ================================================================== */

type TypeState = { lastRow: number; lastChange: number; sig: string };

const typewriter: FxLayer = {
	id: "typewriter",
	name: "Live Line",
	group: "reactive",
	blurb: "the line currently being written gets a travelling highlight",
	defaultIntensity: 0.5,
	cost: 1,
	apply(ctx, k) {
		const { frame, tuning } = ctx;
		const st = slot<TypeState>(ctx, "typewriter", () => ({ lastRow: -1, lastChange: -10, sig: "" }));

		// Find the lowest row whose raw content changed since last frame.
		let changed = -1;
		for (let y = frame.rows.length - 1; y >= 0; y--) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			if (row.raw.trim().length === 0) continue;
			changed = y;
			break;
		}
		const sig = changed >= 0 ? frame.rows[changed]!.raw : "";
		if (sig !== st.sig) {
			st.sig = sig;
			st.lastRow = changed;
			st.lastChange = ctx.time;
		}
		const age = ctx.time - st.lastChange;
		if (age > 1.4 || st.lastRow < 0) return;
		const row = frame.rows[st.lastRow];
		if (!row || row.skip) return;
		const fade = (1 - age / 1.4) * k;
		const sweep = (ctx.time * 1.6) % 1;
		for (const cell of row.cells) {
			const pos = cell.col / Math.max(1, row.used || 1);
			const a = bump(pos, sweep, 0.22) * fade;
			if (a < 0.04) continue;
			cell.outFg = screenBlend(cell.outFg ?? tuning.fg, scaleLightness(sampleRamp(tuning.ramp, sweep), a * 0.8));
			row.dirty = true;
		}
	},
};

/* ================================================================== *
 * shine — a specular band sweeping across the screen
 * ================================================================== */

const shine: FxLayer = {
	id: "shine",
	name: "Shine Sweep",
	group: "post",
	blurb: "a bar of light sliding across, like glare on glass",
	defaultIntensity: 0.55,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const period = 4.5;
		const pos = ((ctx.time % period) / period) * 1.8 - 0.4;
		const half = 0.09;
		eachCell(frame, (cell, row, x, y) => {
			const p = x / Math.max(1, width) + (y / Math.max(1, rows)) * 0.35;
			const a = bump(p, pos, half) * k;
			if (a < 0.03) return;
			if (cell.outFg) cell.outFg = screenBlend(cell.outFg, scaleLightness(tuning.fg, a * 0.7));
			cell.outBg = screenBlend(cell.outBg ?? tuning.bg, scaleLightness(sampleRamp(tuning.ramp, p), a * 0.35));
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * spotlight — a torch that follows the cursor
 * ================================================================== */

const spotlight: FxLayer = {
	id: "spotlight",
	name: "Spotlight",
	group: "reactive",
	blurb: "a pool of light around the cursor; everything else falls into shadow",
	defaultIntensity: 0.5,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const cx = ctx.cursor?.x ?? width / 2;
		const cy = ctx.cursor?.y ?? rows - 2;
		const radius = Math.max(8, width * 0.3);
		const falloff = 1 + k * 1.2;
		eachCell(frame, (cell, row, x, y) => {
			const d = Math.hypot(x - cx, (y - cy) * 2.1) / radius;
			const lit = clamp01(1 - d ** 1.6) ** falloff;
			const dark = 1 - k * 0.8 * (1 - lit);
			if (dark >= 0.995) return;
			if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, dark);
			if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, dark);
			else if (dark < 0.85) cell.outBg = scaleLightness(tuning.bg, dark);
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * lightning — flash plus a jagged bolt
 * ================================================================== */

type Bolt = { t0: number; x: number; seed: number };

const lightning: FxLayer = {
	id: "lightning",
	name: "Lightning",
	group: "post",
	blurb: "the whole screen flashes and a bolt forks down it",
	defaultIntensity: 0.6,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const bolts = slot<Bolt[]>(ctx, "lightning", () => []);
		if (ctx.rnd() < ctx.dt * (0.08 + k * 0.35)) {
			bolts.push({ t0: ctx.time, x: ctx.rnd() * width, seed: Math.floor(ctx.rnd() * 65536) });
		}
		for (let i = bolts.length - 1; i >= 0; i--) if (ctx.time - bolts[i]!.t0 > 0.55) bolts.splice(i, 1);
		if (bolts.length === 0) return;

		for (const b of bolts) {
			const age = ctx.time - b.t0;
			// Two quick flashes, as real lightning does.
			const flash = Math.max(0, Math.cos(age * 26) ) * Math.exp(-age * 7) * k;
			if (flash > 0.01) {
				eachCell(frame, (cell, row) => {
					if (cell.outFg) cell.outFg = screenBlend(cell.outFg, scaleLightness(rgb(220, 230, 255), flash * 0.8));
					cell.outBg = screenBlend(cell.outBg ?? tuning.bg, scaleLightness(rgb(150, 170, 220), flash * 0.5));
					row.dirty = true;
				});
			}
			const vis = Math.exp(-age * 9);
			if (vis < 0.05) continue;
			let x = b.x;
			for (let y = 0; y < rows; y++) {
				x += (hash2(y, b.seed, 17) - 0.5) * 5;
				const row = frame.rows[y];
				if (!row || row.skip) continue;
				for (let o = -1; o <= 1; o++) {
					const cell = row.byCol[Math.round(x) + o];
					if (!cell) continue;
					const a = (o === 0 ? 1 : 0.35) * vis;
					cell.outFg = screenBlend(cell.outFg ?? tuning.fg, scaleLightness(rgb(235, 240, 255), a));
					if (o === 0 && cell.blank && !cell.claimed) draw(row, cell, "│", rgb(240, 245, 255));
					row.dirty = true;
				}
			}
		}
	},
};

/* ================================================================== *
 * breathing — global slow lightness swell
 * ================================================================== */

const breathing: FxLayer = {
	id: "breathing",
	name: "Breathing",
	group: "post",
	blurb: "the whole screen swells and dims, slowly",
	defaultIntensity: 0.35,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		const f = 1 + Math.sin(ctx.time * 0.9) * 0.22 * k;
		if (Math.abs(f - 1) < 0.01) return;
		eachCell(frame, (cell, row) => {
			if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, f);
			if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, f);
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * wobble — per-row hue offset, a heat-haze for colour
 * ================================================================== */

const wobble: FxLayer = {
	id: "wobble",
	name: "Wobble",
	group: "post",
	blurb: "rows shift hue out of phase, like heat haze",
	defaultIntensity: 0.4,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		for (let y = 0; y < frame.rows.length; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const turn = Math.sin(y * 0.38 + ctx.time * 2.1) * 0.08 * k;
			if (Math.abs(turn) < 0.004) continue;
			for (const cell of row.cells) {
				if (cell.outFg) cell.outFg = rotateHue(cell.outFg, turn);
				if (cell.outBg) cell.outBg = rotateHue(cell.outBg, turn * 0.6);
			}
			row.dirty = true;
		}
	},
};

/* ================================================================== *
 * glitch — datamosh: row tearing, channel split, glyph corruption
 * ================================================================== */

const CORRUPT = "▓▒░█▌▐▀▄│┤╡╢╖╕╣║╗╝┐└┴┬├─┼╞╟╚╔╩╦╠═╬";

const glitch: FxLayer = {
	id: "glitch",
	name: "Glitch",
	group: "post",
	blurb: "torn rows, channel separation and corrupted glyphs — in bursts",
	defaultIntensity: 0.4,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		// Bursty: mostly quiet, occasionally violent.
		const burst = valueNoise(ctx.time * 1.7, 0, 313);
		const active = clamp01((burst - (0.76 - k * 0.3)) * 6) * k;
		if (active < 0.02) return;

		const seedT = Math.floor(ctx.time * 20);
		for (let y = 0; y < rows; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const rowRoll = hash2(y, seedT, 7);
			if (rowRoll > 0.12 + active * 0.35) continue;

			const shift = Math.round((hash2(y, seedT, 11) - 0.5) * width * 0.25 * active);
			const split = hash2(y, seedT, 13) < 0.5;

			// Horizontal tear: re-colour from a shifted source cell.
			const snapshot = row.cells.map((c) => c.outFg);
			for (const cell of row.cells) {
				const src = snapshot[Math.max(0, Math.min(snapshot.length - 1, cell.col + shift))];
				if (src) cell.outFg = src;
				if (split && cell.outFg) {
					cell.outFg = rotateHue(cell.outFg, hash2(cell.col, y, seedT) < 0.5 ? 0.18 : -0.18);
				}
				if (hash2(cell.col, y, seedT + 5) < 0.05 * active && cell.width === 1) {
					cell.outText = CORRUPT[Math.floor(hash2(cell.col, y, seedT + 9) * CORRUPT.length)]!;
					cell.outFg = sampleRamp(tuning.ramp, hash2(cell.col, y, seedT + 2));
				}
			}
			row.dirty = true;
		}
	},
};

/* ================================================================== *
 * aberration — chromatic fringing toward the screen edges
 * ================================================================== */

const aberration: FxLayer = {
	id: "aberration",
	name: "Chromatic Aberration",
	group: "post",
	blurb: "colour fringing that gets worse toward the edges, like cheap glass",
	defaultIntensity: 0.4,
	cost: 1,
	apply(ctx, k) {
		const { frame, width } = ctx;
		const rows = frame.rows.length;
		eachCell(frame, (cell, row, x, y) => {
			const dx = (x / Math.max(1, width)) * 2 - 1;
			const dy = (y / Math.max(1, rows)) * 2 - 1;
			const r = Math.hypot(dx, dy * 0.5);
			const amt = r * r * k * 0.22;
			if (amt < 0.006) return;
			if (cell.outFg) cell.outFg = rotateHue(cell.outFg, dx > 0 ? amt : -amt);
			if (cell.outBg) cell.outBg = rotateHue(cell.outBg, dx > 0 ? -amt : amt);
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * strobe — brief full-frame inversion
 * ================================================================== */

const strobe: FxLayer = {
	id: "strobe",
	name: "Strobe",
	group: "post",
	blurb: "momentary full-screen inversion — genuinely obnoxious, use sparingly",
	defaultIntensity: 0.25,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		const period = 6 - k * 4;
		const phase = (ctx.time % period) / period;
		if (phase > 0.04) return;
		eachCell(frame, (cell, row) => {
			if (cell.outFg) cell.outFg = invertRgb(cell.outFg);
			if (cell.outBg) cell.outBg = invertRgb(cell.outBg);
			else cell.outInverse = !cell.outInverse;
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * interlace — CRT field interlacing
 * ================================================================== */

const interlace: FxLayer = {
	id: "interlace",
	name: "Interlace",
	group: "post",
	blurb: "odd and even fields drift apart, like a mistimed CRT",
	defaultIntensity: 0.35,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		const field = Math.floor(ctx.time * 30) % 2;
		for (let y = 0; y < frame.rows.length; y++) {
			if (y % 2 !== field) continue;
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const f = 1 - 0.22 * k;
			for (const cell of row.cells) {
				if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, f);
				if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, f);
			}
			row.dirty = true;
		}
	},
};

/* ================================================================== *
 * bloom — bright cells bleed into their neighbours
 * ================================================================== */

const bloom: FxLayer = {
	id: "bloom",
	name: "Bloom",
	group: "post",
	blurb: "bright glyphs bleed light into the cells around them",
	defaultIntensity: 0.45,
	cost: 3,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const lum = new Float32Array(width * rows);
		const hue: (RGB | null)[] = new Array(width * rows).fill(null);

		eachCell(frame, (cell, _row, x, y) => {
			if (!cell.outFg) return;
			const l = lightness(cell.outFg);
			if (l < 0.68) return;
			const i = y * width + x;
			if (i < 0 || i >= lum.length) return;
			lum[i] = (l - 0.68) / 0.32;
			hue[i] = cell.outFg;
		});

		const spread = 1 + Math.round(k);
		eachCell(frame, (cell, row, x, y) => {
			// Glow lands in the space around glyphs. Painting it onto the
			// glyphs themselves just draws a highlighter box round every word.
			if (isText(cell)) return;
			let acc = 0;
			let col: RGB | null = null;
			for (let dy = -spread; dy <= spread; dy++) {
				for (let dx = -spread; dx <= spread; dx++) {
					if (dx === 0 && dy === 0) continue;
					const nx = x + dx;
					const ny = y + dy;
					if (nx < 0 || nx >= width || ny < 0 || ny >= rows) continue;
					const i = ny * width + nx;
					const l = lum[i]!;
					if (l <= 0) continue;
					const w = l / (1 + dx * dx + dy * dy * 4);
					acc += w;
					if (!col || w > 0.2) col = hue[i];
				}
			}
			if (acc < 0.02 || !col) return;
			const a = clamp01(acc * k * 0.8);
			cell.outBg = screenBlend(cell.outBg ?? tuning.bg, scaleLightness(col, a * 0.16));
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * scanlines — CRT line structure
 * ================================================================== */

const scanlines: FxLayer = {
	id: "scanlines",
	name: "Scanlines",
	group: "post",
	blurb: "every other row darkens — instant CRT",
	defaultIntensity: 0.45,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		const roll = Math.floor(ctx.time * 3) % 2;
		for (let y = 0; y < frame.rows.length; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			if ((y + roll) % 2 === 0) continue;
			const f = 1 - 0.38 * k;
			for (const cell of row.cells) {
				if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, f);
				if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, f);
			}
			row.dirty = true;
		}
	},
};

/* ================================================================== *
 * vignette — darken toward the edges
 * ================================================================== */

const vignette: FxLayer = {
	id: "vignette",
	name: "Vignette",
	group: "post",
	blurb: "corners fall away into the dark",
	defaultIntensity: 0.5,
	cost: 1,
	apply(ctx, k) {
		const { frame, width } = ctx;
		const rows = frame.rows.length;
		eachCell(frame, (cell, row, x, y) => {
			const dx = (x / Math.max(1, width - 1)) * 2 - 1;
			const dy = (y / Math.max(1, rows - 1)) * 2 - 1;
			const r = clamp01(Math.hypot(dx, dy) / 1.414);
			const f = 1 - r ** 2.2 * k * 0.85;
			if (f >= 0.995) return;
			if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, f);
			if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, f);
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * dither — quantise to the 16 ANSI colours with an ordered dither
 * ================================================================== */

const dither: FxLayer = {
	id: "dither",
	name: "16-Colour Dither",
	group: "post",
	blurb: "crush everything to the xterm 16 with a Bayer dither — 1991 mode",
	defaultIntensity: 0.8,
	cost: 2,
	apply(ctx, k) {
		const { frame } = ctx;
		const amt = clamp01(k);
		eachCell(frame, (cell, row, x, y) => {
			const b = BAYER4[y & 3]![x & 3]! * 46;
			if (cell.outFg) {
				const nudged = { r: cell.outFg.r + b, g: cell.outFg.g + b, b: cell.outFg.b + b };
				cell.outFg = mixRgb(cell.outFg, nearestFrom(nudged, ANSI16), amt);
			}
			if (cell.outBg) {
				const nudged = { r: cell.outBg.r + b, g: cell.outBg.g + b, b: cell.outBg.b + b };
				cell.outBg = mixRgb(cell.outBg, nearestFrom(nudged, ANSI16), amt);
			}
			row.dirty = true;
		});
	},
};

/* ================================================================== *
 * noisegrain — film grain
 * ================================================================== */

const noisegrain: FxLayer = {
	id: "noisegrain",
	name: "Film Grain",
	group: "post",
	blurb: "per-cell luminance noise, like pushed film",
	defaultIntensity: 0.3,
	cost: 1,
	apply(ctx, k) {
		const { frame } = ctx;
		const seedT = Math.floor(ctx.time * 24);
		eachCell(frame, (cell, row, x, y) => {
			const n = (hash2(x, y, seedT) - 0.5) * 0.45 * k;
			if (Math.abs(n) < 0.012) return;
			if (cell.outFg) cell.outFg = scaleLightness(cell.outFg, 1 + n);
			if (cell.outBg) cell.outBg = scaleLightness(cell.outBg, 1 + n);
			row.dirty = true;
		});
	},
};

registerFx(
	neon,
	shadow,
	heat,
	typewriter,
	shine,
	spotlight,
	lightning,
	breathing,
	wobble,
	glitch,
	aberration,
	strobe,
	interlace,
	bloom,
	scanlines,
	vignette,
	dither,
	noisegrain,
);

export const POST_FX = [
	neon,
	shadow,
	heat,
	typewriter,
	shine,
	spotlight,
	lightning,
	breathing,
	wobble,
	glitch,
	aberration,
	strobe,
	interlace,
	bloom,
	scanlines,
	vignette,
	dither,
	noisegrain,
];

void grayscale;
void shade;
void triangle;
