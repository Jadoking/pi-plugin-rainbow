/**
 * Colour engine for pi-rainbow.
 *
 * Everything that touches pixels goes through here. Gradients are interpolated in
 * OKLab (perceptually uniform) rather than sRGB, which is why the palettes look
 * smooth instead of muddy-brown-in-the-middle.
 */

export type RGB = { r: number; g: number; b: number };

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Wrap into [0,1). Handles negatives, unlike `%`. */
export const wrap01 = (v: number): number => {
	const w = v % 1;
	return w < 0 ? w + 1 : w;
};

export const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

export function parseHex(hex: string): RGB {
	let h = hex.trim().replace(/^#/, "");
	if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
	if (h.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(h)) return { r: 255, g: 255, b: 255 };
	return {
		r: Number.parseInt(h.slice(0, 2), 16),
		g: Number.parseInt(h.slice(2, 4), 16),
		b: Number.parseInt(h.slice(4, 6), 16),
	};
}

export function toHex(c: RGB): string {
	const h = (v: number) => clamp255(v).toString(16).padStart(2, "0");
	return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/* ------------------------------------------------------------------ *
 * OKLab / OKLCH
 * Björn Ottosson's transform. Operates on linear-light sRGB.
 * ------------------------------------------------------------------ */

const srgbToLinear = (c: number): number => {
	const v = c / 255;
	return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (v: number): number => {
	const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
	return clamp255(c * 255);
};

export type OKLab = { L: number; a: number; b: number };

export function rgbToOklab(c: RGB): OKLab {
	const r = srgbToLinear(c.r);
	const g = srgbToLinear(c.g);
	const b = srgbToLinear(c.b);

	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

	return {
		L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	};
}

export function oklabToRgb(c: OKLab): RGB {
	const l_ = c.L + 0.3963377774 * c.a + 0.2158037573 * c.b;
	const m_ = c.L - 0.1055613458 * c.a - 0.0638541728 * c.b;
	const s_ = c.L - 0.0894841775 * c.a - 1.291485548 * c.b;

	const l = l_ * l_ * l_;
	const m = m_ * m_ * m_;
	const s = s_ * s_ * s_;

	return {
		r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
		g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
		b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
	};
}

export type OKLCH = { L: number; C: number; h: number };

export function rgbToOklch(c: RGB): OKLCH {
	const lab = rgbToOklab(c);
	return {
		L: lab.L,
		C: Math.hypot(lab.a, lab.b),
		h: wrap01(Math.atan2(lab.b, lab.a) / (Math.PI * 2)),
	};
}

export function oklchToRgb(c: OKLCH): RGB {
	const t = c.h * Math.PI * 2;
	return oklabToRgb({ L: c.L, a: Math.cos(t) * c.C, b: Math.sin(t) * c.C });
}

/** Mix two colours in OKLab. Linear in perceived lightness, no grey dip. */
export function mixOklab(a: RGB, b: RGB, t: number): RGB {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const A = rgbToOklab(a);
	const B = rgbToOklab(b);
	return oklabToRgb({
		L: lerp(A.L, B.L, t),
		a: lerp(A.a, B.a, t),
		b: lerp(A.b, B.b, t),
	});
}

/** Straight sRGB mix. Cheaper; used in inner loops where accuracy does not matter. */
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
	if (t <= 0) return a;
	if (t >= 1) return b;
	return {
		r: clamp255(lerp(a.r, b.r, t)),
		g: clamp255(lerp(a.g, b.g, t)),
		b: clamp255(lerp(a.b, b.b, t)),
	};
}

/** Relative luminance, 0..1, for contrast decisions. */
export function luminance(c: RGB): number {
	return (0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b));
}

/** Perceptual lightness 0..1 (OKLab L). Better than luminance for "is this dark". */
export function lightness(c: RGB): number {
	return clamp01(rgbToOklab(c).L);
}

/** Shift lightness by `amount` (-1..1) while holding hue/chroma. */
export function shade(c: RGB, amount: number): RGB {
	if (amount === 0) return c;
	const lab = rgbToOklab(c);
	const L = clamp01(lab.L + amount);
	// Pull chroma in as we approach the ends, otherwise colours go neon-radioactive.
	const squeeze = 1 - Math.abs(L - 0.5) * 0.35;
	return oklabToRgb({ L, a: lab.a * squeeze, b: lab.b * squeeze });
}

/** Multiply lightness (0 = black, 1 = unchanged, >1 = brighter). */
export function scaleLightness(c: RGB, factor: number): RGB {
	if (factor === 1) return c;
	const lab = rgbToOklab(c);
	return oklabToRgb({ L: clamp01(lab.L * factor), a: lab.a, b: lab.b });
}

/** Scale chroma. 0 = greyscale, 1 = unchanged, >1 = more vivid. */
export function saturate(c: RGB, factor: number): RGB {
	if (factor === 1) return c;
	const lab = rgbToOklab(c);
	return oklabToRgb({ L: lab.L, a: lab.a * factor, b: lab.b * factor });
}

/** Rotate hue by `turns` (1.0 = full circle). */
export function rotateHue(c: RGB, turns: number): RGB {
	if (turns === 0) return c;
	const lch = rgbToOklch(c);
	return oklchToRgb({ L: lch.L, C: lch.C, h: wrap01(lch.h + turns) });
}

export function invert(c: RGB): RGB {
	return { r: 255 - c.r, g: 255 - c.g, b: 255 - c.b };
}

export function grayscale(c: RGB): RGB {
	const lab = rgbToOklab(c);
	return oklabToRgb({ L: lab.L, a: 0, b: 0 });
}

/** Screen blend — brightens, never clips to white as hard as additive. */
export function screenBlend(a: RGB, b: RGB): RGB {
	return {
		r: 255 - ((255 - a.r) * (255 - b.r)) / 255,
		g: 255 - ((255 - a.g) * (255 - b.g)) / 255,
		b: 255 - ((255 - a.b) * (255 - b.b)) / 255,
	};
}

export function addBlend(a: RGB, b: RGB, amount = 1): RGB {
	return {
		r: clamp255(a.r + b.r * amount),
		g: clamp255(a.g + b.g * amount),
		b: clamp255(a.b + b.b * amount),
	};
}

export function multiplyBlend(a: RGB, b: RGB): RGB {
	return { r: (a.r * b.r) / 255, g: (a.g * b.g) / 255, b: (a.b * b.b) / 255 };
}

/* ------------------------------------------------------------------ *
 * Palette ramps
 * ------------------------------------------------------------------ */

export type Ramp = {
	/** Source stops, in order. */
	stops: RGB[];
	/** Pre-baked lookup table for fast sampling. */
	lut: RGB[];
	cyclic: boolean;
};

const LUT_SIZE = 512;

/**
 * Build a sampling ramp from colour stops.
 *
 * `cyclic` wraps the last stop back to the first so scrolling gradients have no
 * visible seam. Non-cyclic ramps ping-pong instead (used for two-colour duotones
 * where wrapping would look like a hard cut).
 */
export function buildRamp(stops: RGB[], cyclic = true): Ramp {
	const src = stops.length > 0 ? stops : [rgb(255, 255, 255)];
	const pts = cyclic ? [...src, src[0]] : [...src, ...src.slice(0, -1).reverse()];
	const lut: RGB[] = new Array(LUT_SIZE);
	const segs = pts.length - 1;
	for (let i = 0; i < LUT_SIZE; i++) {
		const t = (i / LUT_SIZE) * segs;
		const idx = Math.min(segs - 1, Math.floor(t));
		lut[i] = mixOklab(pts[idx], pts[idx + 1], t - idx);
	}
	return { stops: src, lut, cyclic };
}

/** Sample a ramp at phase `p` (any real number; wraps). */
export function sampleRamp(ramp: Ramp, p: number): RGB {
	const idx = Math.floor(wrap01(p) * LUT_SIZE) % LUT_SIZE;
	return ramp.lut[idx < 0 ? idx + LUT_SIZE : idx];
}

/** Crossfade two ramps into a new one — used when switching presets smoothly. */
export function blendRamps(a: Ramp, b: Ramp, t: number): Ramp {
	if (t <= 0) return a;
	if (t >= 1) return b;
	const lut: RGB[] = new Array(LUT_SIZE);
	for (let i = 0; i < LUT_SIZE; i++) lut[i] = mixOklab(a.lut[i], b.lut[i], t);
	return { stops: a.stops, lut, cyclic: a.cyclic };
}

/* ------------------------------------------------------------------ *
 * Terminal colour quantisation (for the retro/dither effect)
 * ------------------------------------------------------------------ */

/** The classic xterm 16. */
export const ANSI16: RGB[] = [
	rgb(0, 0, 0),
	rgb(205, 49, 49),
	rgb(13, 188, 121),
	rgb(229, 229, 16),
	rgb(36, 114, 200),
	rgb(188, 63, 188),
	rgb(17, 168, 205),
	rgb(229, 229, 229),
	rgb(102, 102, 102),
	rgb(241, 76, 76),
	rgb(35, 209, 139),
	rgb(245, 245, 67),
	rgb(59, 142, 234),
	rgb(214, 112, 214),
	rgb(41, 184, 219),
	rgb(255, 255, 255),
];

/** 4x4 Bayer matrix, normalised to -0.5..0.5. */
export const BAYER4 = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5],
].map((row) => row.map((v) => v / 16 - 0.5));

export function nearestFrom(c: RGB, palette: RGB[]): RGB {
	let best = palette[0];
	let bestD = Number.POSITIVE_INFINITY;
	const lab = rgbToOklab(c);
	for (const p of palette) {
		const pl = rgbToOklab(p);
		const d = (lab.L - pl.L) ** 2 * 2 + (lab.a - pl.a) ** 2 + (lab.b - pl.b) ** 2;
		if (d < bestD) {
			bestD = d;
			best = p;
		}
	}
	return best;
}
