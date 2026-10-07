#!/usr/bin/env node
/**
 * Per-stage cost of a rainbow frame, measured rather than guessed.
 *
 * The engine runs on every pi render at 24fps, so its budget is ~41ms and it
 * shares that with pi's own work. This drives the real modules over a realistic
 * grid and reports where the time actually goes, so optimisation effort lands
 * on whatever dominates instead of on whatever looks expensive.
 *
 * Usage: node bench/frame-bench.mjs [cols] [rows] [iterations]
 */
import {
	bandLightness,
	contrastRatio,
	ensureContrast,
	mixRgb,
	oklchToRgb,
	rgbToOklch,
	sampleRamp,
	saturate,
	shade,
} from "/tmp/rbbench/color.js";
import { fieldPhase, makeFieldState } from "/tmp/rbbench/field.js";
import { rampFor } from "/tmp/rbbench/presets.js";

const COLS = Number(process.argv[2] ?? 100);
const ROWS = Number(process.argv[3] ?? 32);
const ITERS = Number(process.argv[4] ?? 200);
const CELLS = COLS * ROWS;

const ramp = rampFor("classic");
const field = makeFieldState({
	mode: "linear",
	motion: "scroll",
	width: COLS,
	height: ROWS,
	time: 3.5,
	turns: 1.5,
	speed: 0.12,
	angle: 0.3,
	seed: 1234,
});

function time(label, fn, perFrameUnits = CELLS) {
	fn(); // warm the JIT
	const t0 = process.hrtime.bigint();
	for (let i = 0; i < ITERS; i++) fn();
	const t1 = process.hrtime.bigint();
	const totalMs = Number(t1 - t0) / 1e6;
	const perFrame = totalMs / ITERS;
	const perUnitNs = (totalMs * 1e6) / (ITERS * perFrameUnits);
	return { label, perFrame, perUnitNs };
}

const results = [];
let sink = 0;

results.push(
	time("fieldPhase (per cell)", () => {
		for (let y = 0; y < ROWS; y++)
			for (let x = 0; x < COLS; x++) sink += fieldPhase(field, x, y);
	}),
);

results.push(
	time("sampleRamp (per cell)", () => {
		for (let i = 0; i < CELLS; i++) sink += sampleRamp(ramp, (i % 1000) / 1000).r;
	}),
);

results.push(
	time("saturate+shade (per cell)", () => {
		for (let i = 0; i < CELLS; i++) {
			const c = saturate({ r: 120, g: 80, b: 200 }, 1.2);
			sink += shade(c, 0.1).r;
		}
	}),
);

results.push(
	time("mixRgb (per cell)", () => {
		for (let i = 0; i < CELLS; i++)
			sink += mixRgb({ r: 20, g: 20, b: 26 }, { r: 200, g: 90, b: 140 }, 0.17).r;
	}),
);

results.push(
	time("rgbToOklch->oklchToRgb roundtrip", () => {
		for (let i = 0; i < CELLS; i++) {
			const o = rgbToOklch({ r: i & 255, g: 90, b: 140 });
			sink += oklchToRgb(o).r;
		}
	}),
);

results.push(
	time("contrastRatio (per cell)", () => {
		for (let i = 0; i < CELLS; i++)
			sink += contrastRatio({ r: i & 255, g: 90, b: 140 }, { r: 20, g: 20, b: 26 });
	}),
);

// The realistic case: most cells already pass and cost one ratio check.
results.push(
	time("ensureContrast, all passing", () => {
		for (let i = 0; i < CELLS; i++)
			sink += ensureContrast({ r: 240, g: 240, b: 245 }, { r: 20, g: 20, b: 26 }, 3.2).r;
	}),
);

// Failing cells, one repeated colour: the memo hits every time. Flattering,
// and not what a real frame looks like.
results.push(
	time("ensureContrast, failing x1 colour", () => {
		for (let i = 0; i < CELLS; i++)
			sink += ensureContrast({ r: 30, g: 28, b: 34 }, { r: 20, g: 20, b: 26 }, 3.2).r;
	}),
);

// Realistic: a frame holds a few dozen distinct failing pairs, because blocks
// are one colour per row and body text uses a handful of theme colours.
results.push(
	time("ensureContrast, failing x32 colours", () => {
		for (let i = 0; i < CELLS; i++)
			sink += ensureContrast(
				{ r: 28 + (i % 32), g: 28, b: 34 },
				{ r: 20, g: 20, b: 26 },
				3.2,
			).r;
	}),
);

// Steady state with many distinct colours. The memo still warms after the
// first frame, which is the honest situation for consecutive frames of an
// unchanging palette.
results.push(
	time("ensureContrast, failing, 3200 distinct (warm)", () => {
		for (let i = 0; i < CELLS; i++)
			sink += ensureContrast(
				{ r: 20 + (i % 40), g: 20 + ((i >> 5) % 40), b: 26 + ((i >> 10) % 40) },
				{ r: 18, g: 18, b: 24 },
				3.2,
			).r;
	}),
);

// Cold: a colour never seen before on every single call, so the memo can never
// help. This is the true cost of one solve, and the cost of the first frame
// after a palette or bundle change.
let cold = 0;
results.push(
	time("ensureContrast, cold solve every cell", () => {
		for (let i = 0; i < CELLS; i++) {
			cold = (cold + 1) & 0xffffff;
			sink += ensureContrast(
				{ r: cold & 63, g: (cold >> 6) & 63, b: (cold >> 12) & 63 },
				{ r: 18, g: 18, b: 24 },
				3.2,
			).r;
		}
	}),
);

results.push(
	time("bandLightness (rule cells only)", () => {
		for (let i = 0; i < COLS * 2; i++)
			sink += bandLightness({ r: i & 255, g: 90, b: 140 }, 0.44, 0.82).r;
	}, COLS * 2),
);

console.log(`grid ${COLS}x${ROWS} = ${CELLS} cells, ${ITERS} iterations`);
console.log(`frame budget at 24fps = 41.67 ms (shared with pi's own render)\n`);
console.log("stage".padEnd(36) + "ms/frame".padStart(10) + "ns/cell".padStart(10) + "  % of budget");
for (const r of results) {
	const pct = (r.perFrame / 41.67) * 100;
	console.log(
		r.label.padEnd(36) +
			r.perFrame.toFixed(3).padStart(10) +
			r.perUnitNs.toFixed(1).padStart(10) +
			`  ${pct.toFixed(1)}%`,
	);
}
if (sink === Number.MIN_SAFE_INTEGER) console.log("");
