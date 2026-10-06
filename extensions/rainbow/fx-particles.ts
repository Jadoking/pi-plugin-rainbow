/**
 * Particle and background-fill effects.
 *
 * These layers draw *into* the frame — mostly into blank cells, so the actual
 * conversation text stays readable. They own their cells via `claimed` once
 * drawn, so later particle layers do not fight over the same space.
 */

import {
	addBlend,
	clamp01,
	mixRgb,
	type RGB,
	sampleRamp,
	scaleLightness,
	screenBlend,
	shade,
} from "./color.js";
import { bump, easeOutCubic, hash2, valueNoise } from "./field.js";
import type { Frame, FrameCell, FrameRow } from "./frame.js";
import { draw, drawIfBlank, type FxContext, type FxLayer, registerFx, slot } from "./fx.js";

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

/** Row accessor that respects skipped (image) rows. */
function rowAt(frame: Frame, y: number): FrameRow | undefined {
	if (y < 0 || y >= frame.rows.length) return undefined;
	const row = frame.rows[y]!;
	return row.skip ? undefined : row;
}

function cellOf(row: FrameRow | undefined, x: number): FrameCell | undefined {
	return row?.byCol[x];
}

/* ================================================================== *
 * plasmafield — colour the empty background with the gradient field
 * ================================================================== */

const plasmafield: FxLayer = {
	id: "plasmafield",
	name: "Plasma Field",
	group: "field",
	blurb: "floods empty space with the live gradient instead of black",
	defaultIntensity: 0.35,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning } = ctx;
		const t = ctx.time;
		for (let y = 0; y < frame.rows.length; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			for (const cell of row.cells) {
				if (!cell.blank || cell.claimed) continue;
				const n =
					valueNoise(cell.col * 0.06 + t * 0.35, y * 0.13 - t * 0.2, 11) * 0.65 +
					valueNoise(cell.col * 0.015 - t * 0.1, y * 0.04 + t * 0.07, 29) * 0.35;
				const col = sampleRamp(tuning.ramp, n * 1.4 + t * 0.05);
				cell.outBg = mixRgb(tuning.bg, scaleLightness(col, 0.55), clamp01(k) * 0.9);
				row.dirty = true;
			}
		}
	},
};

/* ================================================================== *
 * gridfloor — synthwave perspective grid along the bottom
 * ================================================================== */

const gridfloor: FxLayer = {
	id: "gridfloor",
	name: "Grid Floor",
	group: "field",
	blurb: "an endless neon grid receding to the horizon",
	defaultIntensity: 0.7,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning, width } = ctx;
		const rows = frame.rows.length;
		const horizon = Math.floor(rows * 0.58);
		const depth = rows - horizon;
		if (depth < 3) return;

		const scroll = ctx.time * 0.9;
		const vanish = width / 2;
		// World units per screen column at distance 1. Bigger = coarser grid.
		const cell0 = 7;

		for (let i = 1; i <= depth; i++) {
			const y = horizon + i - 1;
			const row = rowAt(frame, y);
			if (!row) continue;

			// Ground-plane perspective: screen row i below the horizon sees
			// world distance d, which blows up as i approaches the horizon.
			const d = depth / i;
			const dNext = depth / (i + 1);

			// A horizontal grid line belongs to this row when an integer world
			// boundary falls inside the slab the row covers. That keeps the
			// lines one row thick instead of smearing near the horizon.
			const a = d * 0.5 - scroll;
			const b = dNext * 0.5 - scroll;
			const lineHit = Math.floor(a) !== Math.floor(b);

			// Near the horizon the vertical lines pack tighter than one cell;
			// drop them there rather than aliasing the whole row solid.
			const worldPerCol = d / cell0;
			const halfWidth = worldPerCol * 0.55;
			const vertOk = halfWidth < 0.34;

			const p = i / depth;
			const glow = clamp01(0.25 + p * 0.95) * k;
			const horiz = sampleRamp(tuning.ramp, p * 0.45 + ctx.time * 0.07);

			for (const cell of row.cells) {
				if (!cell.blank || cell.claimed) continue;
				let vertHit = false;
				if (vertOk) {
					const u = (cell.col - vanish) * worldPerCol;
					vertHit = Math.abs(u - Math.round(u)) < halfWidth;
				}
				if (!lineHit && !vertHit) continue;
				// Horizontal lines are the ones that sell the perspective, so
				// give them a floor brightness even far back.
				const strength = lineHit ? Math.max(glow, 0.5 * k) : 0.75 * glow;
				if (strength < 0.04) continue;
				draw(
					row,
					cell,
					lineHit && vertHit ? "┼" : lineHit ? "─" : "│",
					mixRgb(tuning.bg, horiz, clamp01(strength)),
					undefined,
				);
			}
		}
	},
};

/* ================================================================== *
 * aurora — slow vertical curtains of light
 * ================================================================== */

const aurora: FxLayer = {
	id: "aurora",
	name: "Aurora",
	group: "field",
	blurb: "slow curtains of light hanging over the screen",
	defaultIntensity: 0.55,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning, width } = ctx;
		const rows = frame.rows.length;
		const t = ctx.time * 0.22;
		for (let y = 0; y < rows; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			for (const cell of row.cells) {
				if (!cell.blank || cell.claimed) continue;
				const x = cell.col;
				const sway = valueNoise(x * 0.035 + t, t * 0.6, 7) * 10 - 5;
				const top = rows * 0.1 + sway;
				const band = valueNoise(x * 0.02 - t * 0.5, 3.1, 19) * rows * 0.45 + rows * 0.2;
				const d = (y - top) / Math.max(1, band);
				if (d < 0 || d > 1) continue;
				const a = Math.sin(d * Math.PI) ** 1.6 * k;
				if (a < 0.03) continue;
				const col = sampleRamp(tuning.ramp, x * 0.004 + d * 0.35 + ctx.time * 0.03);
				cell.outBg = mixRgb(cell.outBg ?? tuning.bg, scaleLightness(col, 0.6), clamp01(a * 0.8));
				row.dirty = true;
			}
		}
		void width;
	},
};

/* ================================================================== *
 * starfield — parallax stars that twinkle
 * ================================================================== */

type Star = { x: number; y: number; z: number; ph: number };

const STAR_GLYPHS = ["·", "˙", "*", "✦", "✧", "+"];

const starfield: FxLayer = {
	id: "starfield",
	name: "Starfield",
	group: "particles",
	blurb: "parallax stars drifting behind everything",
	defaultIntensity: 0.6,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const count = Math.max(8, Math.round(width * rows * 0.012 * (0.4 + k)));
		const stars = slot<Star[]>(ctx, "starfield", () => []);
		while (stars.length < count) {
			stars.push({ x: ctx.rnd() * width, y: ctx.rnd() * rows, z: 0.15 + ctx.rnd() * 0.85, ph: ctx.rnd() * 10 });
		}
		if (stars.length > count) stars.length = count;

		for (const s of stars) {
			s.x -= s.z * ctx.dt * 3.5;
			if (s.x < 0) {
				s.x += width;
				s.y = ctx.rnd() * rows;
			}
			const row = rowAt(frame, Math.floor(s.y));
			const cell = cellOf(row, Math.floor(s.x));
			if (!row || !cell) continue;
			const tw = 0.55 + 0.45 * Math.sin(ctx.time * (1.2 + s.z * 2) + s.ph);
			const bright = clamp01(s.z * tw * k);
			if (bright < 0.08) continue;
			const col = mixRgb(tuning.bg, sampleRamp(tuning.ramp, s.z * 0.7 + ctx.time * 0.02), bright);
			drawIfBlank(row, cell, STAR_GLYPHS[Math.min(5, Math.floor(bright * 6))]!, col);
		}
	},
};

/* ================================================================== *
 * tunnelrings — concentric rings pushing outward from the centre
 * ================================================================== */

const tunnelrings: FxLayer = {
	id: "tunnelrings",
	name: "Tunnel Rings",
	group: "field",
	blurb: "concentric rings racing out from the middle of the screen",
	defaultIntensity: 0.5,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning, width } = ctx;
		const rows = frame.rows.length;
		const cx = width / 2;
		const cy = rows / 2;
		const t = ctx.time * 0.9;
		for (let y = 0; y < rows; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			const dy = (y - cy) * 2.1;
			for (const cell of row.cells) {
				if (!cell.blank || cell.claimed) continue;
				const dx = cell.col - cx;
				const d = Math.hypot(dx, dy) / Math.max(1, width);
				const phase = (d * 6 - t) % 1;
				const a = bump(phase < 0 ? phase + 1 : phase, 0.5, 0.18) * k;
				if (a < 0.05) continue;
				const col = sampleRamp(tuning.ramp, d + ctx.time * 0.05);
				cell.outBg = mixRgb(cell.outBg ?? tuning.bg, scaleLightness(col, 0.5), clamp01(a * 0.75));
				row.dirty = true;
			}
		}
	},
};

/* ================================================================== *
 * fire — the classic Doom fire algorithm, burning up from the bottom
 * ================================================================== */

const FIRE_GLYPHS = [" ", "░", "▒", "▓", "█"];

const fire: FxLayer = {
	id: "fire",
	name: "Doom Fire",
	group: "particles",
	blurb: "the 1993 PSX fire algorithm, licking up from the bottom row",
	defaultIntensity: 0.65,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const h = Math.max(4, Math.min(rows, Math.round(rows * (0.25 + k * 0.5))));
		const key = `fire:${width}:${h}`;
		const buf = slot<Uint8Array>(ctx, key, () => new Uint8Array(width * h));

		// Seed the bottom row, then propagate upward with random decay.
		const base = (h - 1) * width;
		for (let x = 0; x < width; x++) {
			const flicker = hash2(x, Math.floor(ctx.time * 14), 3);
			buf[base + x] = flicker > 0.12 ? 255 : 110;
		}
		for (let y = h - 1; y > 0; y--) {
			for (let x = 0; x < width; x++) {
				const src = y * width + x;
				const decay = Math.floor(hash2(x, y * 31 + Math.floor(ctx.time * 30), 5) * 3);
				const dst = src - width - decay + 1;
				const nx = (dst % width + width) % width;
				const ny = Math.floor(dst / width);
				if (ny < 0) continue;
				const v = buf[src]! - decay * 14;
				buf[ny * width + nx] = v < 0 ? 0 : v;
			}
		}

		const top = rows - h;
		for (let y = 0; y < h; y++) {
			const row = rowAt(frame, top + y);
			if (!row) continue;
			for (let x = 0; x < width; x++) {
				const heat = buf[y * width + x]! / 255;
				if (heat < 0.06) continue;
				const cell = row.byCol[x];
				if (!cell || !cell.blank || cell.claimed) continue;
				const col = sampleRamp(tuning.ramp, 1 - heat * 0.85);
				const gi = Math.min(4, Math.floor(heat * 5.2));
				const lit = mixRgb(tuning.bg, col, clamp01(heat * k * 1.3));
				draw(row, cell, FIRE_GLYPHS[gi]!, lit);
			}
		}
	},
};

/* ================================================================== *
 * matrix — digital rain
 * ================================================================== */

type Drop = { y: number; speed: number; len: number; seed: number; on: boolean };

const MATRIX_CHARS = "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789";

const matrix: FxLayer = {
	id: "matrix",
	name: "Digital Rain",
	group: "particles",
	blurb: "falling glyph columns with bright white heads",
	defaultIntensity: 0.55,
	cost: 2,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const drops = slot<Drop[]>(ctx, "matrix", () => []);
		while (drops.length < width) {
			drops.push({
				y: -ctx.rnd() * rows * 2,
				speed: 6 + ctx.rnd() * 22,
				len: 4 + Math.floor(ctx.rnd() * 18),
				seed: Math.floor(ctx.rnd() * 65536),
				on: ctx.rnd() < 0.5,
			});
		}
		if (drops.length > width) drops.length = width;

		const density = clamp01(k);
		for (let x = 0; x < width; x++) {
			const d = drops[x]!;
			d.y += d.speed * ctx.dt;
			if (d.y - d.len > rows) {
				d.y = -ctx.rnd() * rows * 0.6;
				d.speed = 6 + ctx.rnd() * 22;
				d.len = 4 + Math.floor(ctx.rnd() * 18);
				d.seed = Math.floor(ctx.rnd() * 65536);
				d.on = ctx.rnd() < 0.35 + density * 0.6;
			}
			if (!d.on) continue;

			const head = Math.floor(d.y);
			for (let i = 0; i < d.len; i++) {
				const y = head - i;
				const row = rowAt(frame, y);
				const cell = cellOf(row, x);
				if (!row || !cell || !cell.blank || cell.claimed) continue;
				const fade = 1 - i / d.len;
				const a = fade * fade * density;
				if (a < 0.05) continue;
				const ch = MATRIX_CHARS[Math.floor(hash2(x, y + Math.floor(ctx.time * 8), d.seed) * MATRIX_CHARS.length)]!;
				const tint = i === 0 ? rgb(230, 255, 235) : sampleRamp(tuning.ramp, 0.3 + fade * 0.4);
				draw(row, cell, ch, mixRgb(tuning.bg, tint, clamp01(a * 1.2)));
			}
		}
	},
};

/* ================================================================== *
 * rain / snow / sakura / bubbles — simple particle systems
 * ================================================================== */

type Particle = { x: number; y: number; vx: number; vy: number; ph: number; g: number };

function particles(ctx: FxContext, id: string, count: number, spawn: () => Particle): Particle[] {
	const list = slot<Particle[]>(ctx, id, () => []);
	while (list.length < count) list.push(spawn());
	if (list.length > count) list.length = count;
	return list;
}

const rain: FxLayer = {
	id: "rain",
	name: "Rain",
	group: "particles",
	blurb: "slanted streaks, with the occasional heavy drop",
	defaultIntensity: 0.5,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const n = Math.round(width * 0.35 * (0.3 + k));
		const list = particles(ctx, "rain", n, () => ({
			x: ctx.rnd() * width,
			y: ctx.rnd() * rows,
			vx: -3 - ctx.rnd() * 3,
			vy: 28 + ctx.rnd() * 34,
			ph: ctx.rnd(),
			g: 0,
		}));
		for (const p of list) {
			p.x += p.vx * ctx.dt;
			p.y += p.vy * ctx.dt;
			if (p.y > rows || p.x < 0) {
				p.x = ctx.rnd() * width * 1.3;
				p.y = -1;
				p.vy = 28 + ctx.rnd() * 34;
			}
			const row = rowAt(frame, Math.floor(p.y));
			const cell = cellOf(row, Math.floor(p.x));
			if (!row || !cell) continue;
			const col = mixRgb(tuning.bg, sampleRamp(tuning.ramp, 0.55 + p.ph * 0.2), clamp01(0.45 + k * 0.45));
			drawIfBlank(row, cell, p.vy > 50 ? "│" : "╲", col);
		}
	},
};

const SNOW_GLYPHS = ["·", "∙", "•", "❄", "❅", "*"];

const snow: FxLayer = {
	id: "snow",
	name: "Snow",
	group: "particles",
	blurb: "drifting flakes that actually drift",
	defaultIntensity: 0.5,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const n = Math.round(width * rows * 0.008 * (0.4 + k));
		const list = particles(ctx, "snow", n, () => ({
			x: ctx.rnd() * width,
			y: ctx.rnd() * rows,
			vx: 0,
			vy: 1.5 + ctx.rnd() * 5,
			ph: ctx.rnd() * 6.28,
			g: ctx.rnd(),
		}));
		for (const p of list) {
			p.y += p.vy * ctx.dt;
			p.x += Math.sin(ctx.time * 0.8 + p.ph) * 2.2 * ctx.dt + 0.15 * ctx.dt;
			if (p.y > rows) {
				p.y = -1;
				p.x = ctx.rnd() * width;
			}
			if (p.x < 0) p.x += width;
			if (p.x >= width) p.x -= width;
			const row = rowAt(frame, Math.floor(p.y));
			const cell = cellOf(row, Math.floor(p.x));
			if (!row || !cell) continue;
			const bright = clamp01(0.35 + p.g * 0.65) * clamp01(0.4 + k);
			const col = mixRgb(tuning.bg, screenBlend(sampleRamp(tuning.ramp, p.g), rgb(180, 190, 200)), bright);
			drawIfBlank(row, cell, SNOW_GLYPHS[Math.floor(p.g * 6) % 6]!, col);
		}
	},
};

const PETALS = ["✿", "❀", "✾", "❁", "·"];

const sakura: FxLayer = {
	id: "sakura",
	name: "Sakura",
	group: "particles",
	blurb: "petals tumbling sideways across the screen",
	defaultIntensity: 0.45,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const n = Math.round(width * rows * 0.004 * (0.4 + k));
		const list = particles(ctx, "sakura", n, () => ({
			x: ctx.rnd() * width,
			y: ctx.rnd() * rows,
			vx: 3 + ctx.rnd() * 6,
			vy: 2 + ctx.rnd() * 4,
			ph: ctx.rnd() * 6.28,
			g: ctx.rnd(),
		}));
		for (const p of list) {
			p.x += (p.vx + Math.sin(ctx.time * 1.6 + p.ph) * 3) * ctx.dt;
			p.y += (p.vy + Math.cos(ctx.time * 1.1 + p.ph) * 1.2) * ctx.dt;
			if (p.x > width || p.y > rows) {
				p.x = -1;
				p.y = ctx.rnd() * rows * 0.8;
			}
			const row = rowAt(frame, Math.floor(p.y));
			const cell = cellOf(row, Math.floor(p.x));
			if (!row || !cell) continue;
			const col = mixRgb(tuning.bg, sampleRamp(tuning.ramp, 0.08 + p.g * 0.2), clamp01(0.5 + k * 0.5));
			drawIfBlank(row, cell, PETALS[Math.floor(p.ph * 2) % PETALS.length]!, col);
		}
	},
};

const BUBBLE_GLYPHS = ["°", "o", "O", "◦", "○"];

const bubbles: FxLayer = {
	id: "bubbles",
	name: "Bubbles",
	group: "particles",
	blurb: "rising bubbles that wobble on the way up",
	defaultIntensity: 0.45,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const n = Math.round(width * 0.25 * (0.3 + k));
		const list = particles(ctx, "bubbles", n, () => ({
			x: ctx.rnd() * width,
			y: rows + ctx.rnd() * rows,
			vx: 0,
			vy: -(3 + ctx.rnd() * 7),
			ph: ctx.rnd() * 6.28,
			g: ctx.rnd(),
		}));
		for (const p of list) {
			p.y += p.vy * ctx.dt;
			p.x += Math.sin(ctx.time * 2.2 + p.ph) * 1.8 * ctx.dt;
			if (p.y < -1) {
				p.y = rows + ctx.rnd() * 4;
				p.x = ctx.rnd() * width;
				p.vy = -(3 + ctx.rnd() * 7);
			}
			const row = rowAt(frame, Math.floor(p.y));
			const cell = cellOf(row, Math.floor(p.x));
			if (!row || !cell) continue;
			const col = mixRgb(tuning.bg, sampleRamp(tuning.ramp, 0.5 + p.g * 0.3), clamp01(0.4 + k * 0.5));
			drawIfBlank(row, cell, BUBBLE_GLYPHS[Math.floor(p.g * 5) % 5]!, col);
		}
	},
};

const fireflies: FxLayer = {
	id: "fireflies",
	name: "Fireflies",
	group: "particles",
	blurb: "warm points wandering on lazy curves",
	defaultIntensity: 0.4,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const n = Math.max(3, Math.round(width * 0.1 * (0.3 + k)));
		const list = particles(ctx, "fireflies", n, () => ({
			x: ctx.rnd() * width,
			y: ctx.rnd() * rows,
			vx: 0,
			vy: 0,
			ph: ctx.rnd() * 6.28,
			g: ctx.rnd(),
		}));
		for (const p of list) {
			const t = ctx.time * (0.3 + p.g * 0.5);
			p.x += Math.sin(t * 1.3 + p.ph) * 4 * ctx.dt;
			p.y += Math.cos(t * 0.9 + p.ph * 1.7) * 2 * ctx.dt;
			if (p.x < 0) p.x += width;
			if (p.x >= width) p.x -= width;
			if (p.y < 0) p.y += rows;
			if (p.y >= rows) p.y -= rows;
			const glow = clamp01((Math.sin(ctx.time * 2.4 + p.ph * 3) * 0.5 + 0.5) ** 2 * k * 1.4);
			if (glow < 0.06) continue;
			const row = rowAt(frame, Math.floor(p.y));
			const cell = cellOf(row, Math.floor(p.x));
			if (!row || !cell) continue;
			const col = mixRgb(tuning.bg, sampleRamp(tuning.ramp, 0.12 + p.g * 0.1), glow);
			drawIfBlank(row, cell, glow > 0.6 ? "✦" : "·", col);
		}
	},
};

/* ================================================================== *
 * confetti — ambient sparkle plus bursts on events
 * ================================================================== */

const CONFETTI = ["▪", "▫", "◆", "◇", "✱", "✳", "✺"];

const confetti: FxLayer = {
	id: "confetti",
	name: "Confetti",
	group: "particles",
	blurb: "sparkles everywhere, and a burst whenever something happens",
	defaultIntensity: 0.4,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const density = k * 0.02 * (1 + ctx.tuning.energy * 2);
		const seedT = Math.floor(ctx.time * 12);
		for (let y = 0; y < rows; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			for (const cell of row.cells) {
				if (!cell.blank || cell.claimed) continue;
				if (hash2(cell.col, y * 7 + seedT, 101) > density) continue;
				const col = sampleRamp(tuning.ramp, hash2(cell.col, y, seedT));
				draw(row, cell, CONFETTI[Math.floor(hash2(cell.col, y, seedT + 3) * CONFETTI.length)]!, col);
			}
		}

		// Bursts from engine events.
		for (const ev of ctx.events) {
			if (ev.kind !== "burst") continue;
			const age = ctx.time - ev.t0;
			if (age < 0 || age > 1.2) continue;
			const r = age * 26;
			const count = Math.round(40 * ev.strength * k);
			for (let i = 0; i < count; i++) {
				const a = (i / count) * Math.PI * 2 + ev.t0;
				const px = Math.round(ev.x + Math.cos(a) * r);
				const py = Math.round(ev.y + (Math.sin(a) * r) / 2.1);
				const row = rowAt(frame, py);
				const cell = cellOf(row, px);
				if (!row || !cell) continue;
				const fade = 1 - age / 1.2;
				drawIfBlank(row, cell, CONFETTI[i % CONFETTI.length]!, mixRgb(tuning.bg, sampleRamp(tuning.ramp, i / count), fade));
			}
		}
	},
};

/* ================================================================== *
 * comet — occasional shooting star with a tail
 * ================================================================== */

type Comet = { x: number; y: number; vx: number; vy: number; life: number; born: number };

const comet: FxLayer = {
	id: "comet",
	name: "Comet",
	group: "particles",
	blurb: "a shooting star with a glowing tail, every so often",
	defaultIntensity: 0.6,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const list = slot<Comet[]>(ctx, "comet", () => []);

		const spawnChance = ctx.dt * (0.25 + k * 1.1);
		if (ctx.rnd() < spawnChance && list.length < 4) {
			const fromLeft = ctx.rnd() < 0.5;
			list.push({
				x: fromLeft ? -4 : width + 4,
				y: ctx.rnd() * rows * 0.6,
				vx: (fromLeft ? 1 : -1) * (45 + ctx.rnd() * 45),
				vy: 9 + ctx.rnd() * 14,
				life: 0,
				born: ctx.time,
			});
		}

		for (let i = list.length - 1; i >= 0; i--) {
			const c = list[i]!;
			c.x += c.vx * ctx.dt;
			c.y += c.vy * ctx.dt;
			c.life += ctx.dt;
			if (c.y > rows + 2 || c.x < -20 || c.x > width + 20 || c.life > 6) {
				list.splice(i, 1);
				continue;
			}
			const tail = 14;
			for (let s = 0; s < tail; s++) {
				const f = s / tail;
				const px = Math.round(c.x - (c.vx * f * 0.1));
				const py = Math.round(c.y - (c.vy * f * 0.1));
				const row = rowAt(frame, py);
				const cell = cellOf(row, px);
				if (!row || !cell) continue;
				const a = (1 - f) ** 1.6 * clamp01(0.5 + k);
				const col = mixRgb(tuning.bg, s === 0 ? rgb(255, 255, 240) : sampleRamp(tuning.ramp, f * 0.5), a);
				drawIfBlank(row, cell, s === 0 ? "✦" : f < 0.4 ? "•" : "·", col);
			}
		}
	},
};

/* ================================================================== *
 * waveform — a reactive bar meter across the bottom row
 * ================================================================== */

const BARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

const waveform: FxLayer = {
	id: "waveform",
	name: "Waveform",
	group: "reactive",
	blurb: "a spectrum analyser along the bottom that jumps when the agent works",
	defaultIntensity: 0.6,
	cost: 1,
	apply(ctx, k) {
		const { frame, width, tuning } = ctx;
		const rows = frame.rows.length;
		const levels = slot<Float32Array>(ctx, `wave:${width}`, () => new Float32Array(width));
		const row = rowAt(frame, rows - 1);
		if (!row) return;
		const drive = 0.25 + ctx.tuning.energy * 0.75;
		for (let x = 0; x < width; x++) {
			const target =
				(valueNoise(x * 0.09, ctx.time * 3.2, 41) * 0.6 + valueNoise(x * 0.3, ctx.time * 6.1, 83) * 0.4) * drive;
			const prev = levels[x]!;
			levels[x] = target > prev ? target : prev + (target - prev) * Math.min(1, ctx.dt * 6);
			const v = clamp01(levels[x]! * k * 1.5);
			if (v < 0.04) continue;
			const cell = row.byCol[x];
			if (!cell || !cell.blank || cell.claimed) continue;
			const col = sampleRamp(tuning.ramp, x / width + ctx.time * 0.08);
			draw(row, cell, BARS[Math.min(7, Math.floor(v * 8))]!, mixRgb(tuning.bg, col, clamp01(0.4 + v)));
		}
	},
};

/* ================================================================== *
 * ripples — expanding rings from keystrokes and tool events
 * ================================================================== */

const ripples: FxLayer = {
	id: "ripples",
	name: "Ripples",
	group: "reactive",
	blurb: "every keystroke drops a stone in the pond",
	defaultIntensity: 0.7,
	cost: 2,
	apply(ctx, k) {
		const { frame, tuning } = ctx;
		const active = ctx.events.filter((e) => e.kind === "ripple" || e.kind === "shockwave");
		if (active.length === 0) return;
		const rows = frame.rows.length;

		for (let y = 0; y < rows; y++) {
			const row = frame.rows[y]!;
			if (row.skip) continue;
			for (const cell of row.cells) {
				let acc = 0;
				let tint: RGB | null = null;
				for (const ev of active) {
					const age = ctx.time - ev.t0;
					const life = ev.kind === "shockwave" ? 1.4 : 0.9;
					if (age < 0 || age > life) continue;
					const r = easeOutCubic(age / life) * (ev.kind === "shockwave" ? 90 : 42);
					const d = Math.hypot(cell.col - ev.x, (y - ev.y) * 2.1);
					const a = bump(d, r, 4 + r * 0.14) * (1 - age / life) * ev.strength;
					if (a <= 0) continue;
					acc += a;
					tint = ev.color ?? sampleRamp(tuning.ramp, ctx.time * 0.2 + d * 0.01);
				}
				if (acc <= 0.02 || !tint) continue;
				const amt = clamp01(acc * k);
				cell.outBg = screenBlend(cell.outBg ?? tuning.bg, scaleLightness(tint, 0.45 * amt));
				if (!cell.blank) cell.outFg = mixRgb(cell.outFg ?? tuning.fg, tint, amt * 0.5);
				row.dirty = true;
			}
		}
	},
};

registerFx(
	plasmafield,
	gridfloor,
	aurora,
	starfield,
	tunnelrings,
	fire,
	matrix,
	rain,
	snow,
	sakura,
	bubbles,
	fireflies,
	confetti,
	comet,
	waveform,
	ripples,
);

export const PARTICLE_FX = [
	plasmafield,
	gridfloor,
	aurora,
	starfield,
	tunnelrings,
	fire,
	matrix,
	rain,
	snow,
	sakura,
	bubbles,
	fireflies,
	confetti,
	comet,
	waveform,
	ripples,
];

void addBlend;
void shade;
