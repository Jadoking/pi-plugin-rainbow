/**
 * Gradient fields and motion.
 *
 * A "field" maps a cell position (x, y) plus time to a phase in [0,1), which is
 * then fed to a palette ramp. Everything that makes the colour move lives here.
 */

export type GradientMode =
	| "diagonal"
	| "horizontal"
	| "vertical"
	| "radial"
	| "conic"
	| "spiral"
	| "ripple"
	| "plasma"
	| "noise"
	| "marble"
	| "moire"
	| "checker"
	| "kaleido"
	| "voronoi"
	| "tunnel"
	| "lissajous";

export const GRADIENT_MODES: { id: GradientMode; label: string; blurb: string }[] = [
	{ id: "diagonal", label: "Diagonal", blurb: "classic 45° sweep" },
	{ id: "horizontal", label: "Horizontal", blurb: "bands run down the columns" },
	{ id: "vertical", label: "Vertical", blurb: "bands run across the rows" },
	{ id: "radial", label: "Radial", blurb: "rings out from the centre" },
	{ id: "conic", label: "Conic", blurb: "colour wheel / pie slices" },
	{ id: "spiral", label: "Spiral", blurb: "conic + radial, a barber pole" },
	{ id: "ripple", label: "Ripple", blurb: "concentric waves, pond style" },
	{ id: "plasma", label: "Plasma", blurb: "demoscene sum-of-sines" },
	{ id: "noise", label: "Noise", blurb: "smooth value noise clouds" },
	{ id: "marble", label: "Marble", blurb: "fbm-warped veins" },
	{ id: "moire", label: "Moiré", blurb: "two interfering ring patterns" },
	{ id: "checker", label: "Checker", blurb: "hard-edged blocks" },
	{ id: "kaleido", label: "Kaleidoscope", blurb: "mirrored wedges" },
	{ id: "voronoi", label: "Voronoi", blurb: "cellular shards" },
	{ id: "tunnel", label: "Tunnel", blurb: "flying down a pipe" },
	{ id: "lissajous", label: "Lissajous", blurb: "two sine axes beating" },
];

export type MotionMode = "scroll" | "pulse" | "wave" | "orbit" | "jitter" | "breathe" | "drift" | "none";

export const MOTION_MODES: { id: MotionMode; label: string; blurb: string }[] = [
	{ id: "scroll", label: "Scroll", blurb: "steady one-way crawl" },
	{ id: "pulse", label: "Pulse", blurb: "ease in, ease out, repeat" },
	{ id: "wave", label: "Wave", blurb: "rows lag behind each other" },
	{ id: "orbit", label: "Orbit", blurb: "the gradient origin circles the screen" },
	{ id: "jitter", label: "Jitter", blurb: "scroll plus nervous twitching" },
	{ id: "breathe", label: "Breathe", blurb: "slow in-and-out, no crawl" },
	{ id: "drift", label: "Drift", blurb: "two incommensurate speeds, never repeats" },
	{ id: "none", label: "Static", blurb: "frozen" },
];

/* ------------------------------------------------------------------ *
 * Cheap deterministic noise
 * ------------------------------------------------------------------ */

/** Integer hash → [0,1). No allocation, stable across runs. */
export function hash2(x: number, y: number, seed = 0): number {
	let h = (x | 0) * 374761393 + (y | 0) * 668265263 + (seed | 0) * 2147483647;
	h = (h ^ (h >>> 13)) * 1274126177;
	h = h ^ (h >>> 16);
	return (h >>> 0) / 4294967296;
}

export function hash1(x: number, seed = 0): number {
	return hash2(x, 0x9e37, seed);
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

/** 2D value noise, [0,1). */
export function valueNoise(x: number, y: number, seed = 0): number {
	const xi = Math.floor(x);
	const yi = Math.floor(y);
	const xf = smooth(x - xi);
	const yf = smooth(y - yi);
	const a = hash2(xi, yi, seed);
	const b = hash2(xi + 1, yi, seed);
	const c = hash2(xi, yi + 1, seed);
	const d = hash2(xi + 1, yi + 1, seed);
	return (a + (b - a) * xf) * (1 - yf) + (c + (d - c) * xf) * yf;
}

/** Fractal brownian motion over value noise. */
export function fbm(x: number, y: number, octaves = 4, seed = 0): number {
	let amp = 0.5;
	let freq = 1;
	let sum = 0;
	let norm = 0;
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise(x * freq, y * freq, seed + i * 37) * amp;
		norm += amp;
		amp *= 0.5;
		freq *= 2.03;
	}
	return sum / norm;
}

/* ------------------------------------------------------------------ *
 * Field evaluation
 * ------------------------------------------------------------------ */

export type FieldParams = {
	mode: GradientMode;
	motion: MotionMode;
	/** Terminal size in cells. */
	width: number;
	height: number;
	/** Seconds since the engine started. */
	time: number;
	/** How many full palette cycles fit across the screen. */
	turns: number;
	/** Cycles per second. */
	speed: number;
	/** Accumulated cycles when speed varies; omitted for constant-speed callers. */
	phase?: number;
	/** Static rotation of the gradient, in turns. */
	angle: number;
	/** Deterministic per-session seed. */
	seed: number;
};

/**
 * Terminal cells are roughly twice as tall as they are wide, so radial/conic
 * fields need vertical pre-scaling or every circle comes out as an egg.
 */
const CELL_ASPECT = 2.1;

export type FieldState = {
	/** Normalised origin for radial-ish modes, 0..1. */
	ox: number;
	oy: number;
	/** Global time offset applied by the motion mode. */
	t: number;
	/** Extra per-row phase skew. */
	rowSkew: number;
	params: FieldParams;
	cosA: number;
	sinA: number;
};

/** Precompute everything that does not vary per cell. One call per frame. */
export function makeFieldState(p: FieldParams): FieldState {
	const phase = p.phase ?? p.time * p.speed;
	let t: number;
	switch (p.motion) {
		case "scroll":
			t = phase;
			break;
		case "pulse":
			t = Math.sin(phase * Math.PI * 2) * 0.5;
			break;
		case "wave":
			t = phase;
			break;
		case "orbit":
			t = phase * 0.5;
			break;
		case "jitter":
			t = phase + (hash1(Math.floor(p.time * 24), p.seed) - 0.5) * 0.08;
			break;
		case "breathe":
			t = (1 - Math.cos(phase * Math.PI)) * 0.25;
			break;
		case "drift":
			t = phase * 0.61803 + Math.sin(phase * 0.37) * 0.3;
			break;
		default:
			t = 0;
			break;
	}

	let ox = 0.5;
	let oy = 0.5;
	if (p.motion === "orbit") {
		ox = 0.5 + Math.cos(phase * 1.3) * 0.33;
		oy = 0.5 + Math.sin(phase * 0.9) * 0.33;
	}

	const a = p.angle * Math.PI * 2;
	return {
		ox,
		oy,
		t,
		rowSkew: p.motion === "wave" ? 1 : 0,
		params: p,
		cosA: Math.cos(a),
		sinA: Math.sin(a),
	};
}

/**
 * Phase for a cell, in [0,1).
 *
 * Hot path: called once per visible cell per frame. Kept branch-y but
 * allocation-free on purpose — a 240x60 fullscreen terminal is 14 400 calls a
 * frame and anything that allocates shows up immediately in GC.
 */
export function fieldPhase(fs: FieldState, cx: number, cy: number): number {
	const p = fs.params;
	const w = p.width || 1;
	const h = p.height || 1;

	// Normalised, aspect-corrected, origin-relative coordinates.
	const nx = cx / w;
	const ny = cy / h;
	const dx = (nx - fs.ox) * 2;
	const dy = ((ny - fs.oy) * 2 * h * CELL_ASPECT) / w;

	// Rotate for the static angle control.
	const rx = dx * fs.cosA - dy * fs.sinA;
	const ry = dx * fs.sinA + dy * fs.cosA;

	const turns = p.turns;
	const t = fs.t;
	let v: number;

	switch (p.mode) {
		case "horizontal":
			v = nx * turns;
			break;
		case "vertical":
			v = ny * turns;
			break;
		case "diagonal":
			v = (nx + ny * 0.6) * turns;
			break;
		case "radial":
			v = Math.hypot(rx, ry) * turns;
			break;
		case "conic":
			v = (Math.atan2(ry, rx) / (Math.PI * 2)) * turns;
			break;
		case "spiral":
			v = (Math.atan2(ry, rx) / (Math.PI * 2)) * turns + Math.hypot(rx, ry) * turns * 1.5;
			break;
		case "ripple": {
			const d = Math.hypot(rx, ry);
			v = Math.sin(d * turns * Math.PI * 3 - t * Math.PI * 2) * 0.5 + 0.5;
			return v - Math.floor(v);
		}
		case "plasma": {
			const a = Math.sin(nx * turns * 6.0 + t * 3.1);
			const b = Math.sin(ny * turns * 5.0 * CELL_ASPECT - t * 2.3);
			const c = Math.sin((nx + ny) * turns * 4.0 + t * 1.7);
			const d = Math.sin(Math.hypot(rx, ry) * turns * 7.0 - t * 2.9);
			v = (a + b + c + d) * 0.125 + 0.5;
			return v - Math.floor(v);
		}
		case "noise":
			v = fbm(nx * turns * 3 + t, ny * turns * 3 * CELL_ASPECT, 3, p.seed) * 1.6;
			break;
		case "marble": {
			const warp = fbm(nx * 3 + t * 0.3, ny * 3 * CELL_ASPECT, 4, p.seed);
			v = Math.sin((nx + warp * 1.4) * turns * Math.PI * 2) * 0.5 + 0.5;
			return v - Math.floor(v);
		}
		case "moire": {
			const d1 = Math.hypot(rx - 0.35, ry);
			const d2 = Math.hypot(rx + 0.35, ry);
			v = (Math.sin(d1 * turns * 20) + Math.sin(d2 * turns * 20)) * 0.25 + 0.5;
			return v - Math.floor(v);
		}
		case "checker": {
			const sz = Math.max(1, Math.round(8 / Math.max(0.25, turns)));
			const gx = Math.floor(cx / (sz * 2));
			const gy = Math.floor(cy / sz);
			v = hash2(gx, gy, p.seed);
			break;
		}
		case "kaleido": {
			const seg = Math.max(2, Math.round(turns * 3));
			let ang = Math.atan2(ry, rx) / (Math.PI * 2) + 0.5;
			ang = (ang * seg) % 1;
			if (ang > 0.5) ang = 1 - ang;
			v = ang * 2 + Math.hypot(rx, ry) * 0.7;
			break;
		}
		case "voronoi": {
			const scale = Math.max(1, turns * 2.5);
			const px = nx * scale;
			const py = ny * scale * CELL_ASPECT;
			const ix = Math.floor(px);
			const iy = Math.floor(py);
			let best = 9;
			let bestId = 0;
			for (let oy2 = -1; oy2 <= 1; oy2++) {
				for (let ox2 = -1; ox2 <= 1; ox2++) {
					const gx = ix + ox2;
					const gy = iy + oy2;
					const jx = gx + hash2(gx, gy, p.seed) * 0.9 + Math.sin(t * 2 + gx) * 0.25;
					const jy = gy + hash2(gx, gy, p.seed + 91) * 0.9 + Math.cos(t * 2 + gy) * 0.25;
					const d = (px - jx) ** 2 + (py - jy) ** 2;
					if (d < best) {
						best = d;
						bestId = (gx * 73856093) ^ (gy * 19349663);
					}
				}
			}
			v = ((bestId >>> 0) % 1000) / 1000 + best * 0.3;
			break;
		}
		case "tunnel": {
			const d = Math.max(0.03, Math.hypot(rx, ry));
			v = 1 / d / 6 + Math.atan2(ry, rx) / (Math.PI * 2);
			v *= turns;
			break;
		}
		case "lissajous": {
			v =
				(Math.sin(nx * turns * Math.PI * 3 + t * 2.1) + Math.sin(ny * turns * Math.PI * 2 * CELL_ASPECT - t * 1.4)) *
					0.25 +
				0.5;
			return v - Math.floor(v);
		}
		default:
			v = (nx + ny) * turns;
			break;
	}

	// Wave motion skews each row so colour appears to roll down the screen.
	if (fs.rowSkew) v += Math.sin(ny * Math.PI * 4 + t * Math.PI * 2) * 0.25;

	v += t;
	return v - Math.floor(v);
}

/* ------------------------------------------------------------------ *
 * Small shared easings used by effects
 * ------------------------------------------------------------------ */

export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const triangle = (t: number): number => {
	const w = t - Math.floor(t);
	return w < 0.5 ? w * 2 : 2 - w * 2;
};
/** Smooth 0→1 band around `centre` with half-width `half`. */
export const bump = (x: number, centre: number, half: number): number => {
	if (half <= 0) return 0;
	const d = Math.abs(x - centre) / half;
	return d >= 1 ? 0 : (1 - d * d) ** 2;
};
