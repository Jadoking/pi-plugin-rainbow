#!/usr/bin/env node
/**
 * Correctness guard for the colour fast paths.
 *
 * Optimisation is only worth anything if the output is unchanged, and a
 * benchmark will happily report a huge speedup for code that has quietly
 * stopped doing the work. This checks the three things that could have broken:
 * the lookup tables must match the formulas they replaced, the contrast solver
 * must still return colours that clear the floor, and the memo must not hand
 * back a result belonging to a different colour pair.
 */
import {
	contrastRatio,
	ensureContrast,
	relativeLuminance,
	rgbToOklch,
} from "/tmp/rbbench/color.js";

let failures = 0;
const fail = (msg) => {
	failures++;
	if (failures <= 10) console.log(`  FAIL ${msg}`);
};

// 1. The WCAG table must reproduce the formula it replaced, exactly.
{
	let worst = 0;
	for (let i = 0; i < 256; i++) {
		const s = i / 255;
		const expect = s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		const got = relativeLuminance({ r: i, g: 0, b: 0 }) / 0.2126;
		worst = Math.max(worst, Math.abs(got - expect));
	}
	console.log(`1. luminance table vs formula: max abs error ${worst.toExponential(3)}`);
	if (worst > 1e-15) fail(`luminance table drifted by ${worst}`);
}

// 2. Solved colours must actually clear the floor.
{
	const MIN = 3.2;
	let checked = 0;
	let worstRatio = Infinity;
	let hueDrift = 0;
	const BANDS = [
		[0.02, "C>0.02 (near-grey)"],
		[0.05, "C>0.05 (muted)"],
		[0.10, "C>0.10 (clearly coloured)"],
	];
	const bandDrift = new Map();
	for (let i = 0; i < 20000; i++) {
		const fg = { r: (i * 7) % 256, g: (i * 29) % 256, b: (i * 83) % 256 };
		const bg = { r: (i * 13) % 256, g: (i * 53) % 256, b: (i * 101) % 256 };
		const out = ensureContrast(fg, bg, MIN);
		const ratio = contrastRatio(out, bg);
		checked++;
		// Allow the documented escape hatch: when even pure black and white
		// cannot clear the bar against this background, the extreme is correct.
		const canWhite = contrastRatio({ r: 255, g: 255, b: 255 }, bg) >= MIN;
		const canBlack = contrastRatio({ r: 0, g: 0, b: 0 }, bg) >= MIN;
		if (canWhite || canBlack) {
			if (ratio < MIN - 1e-6) {
				fail(`ratio ${ratio.toFixed(3)} < ${MIN} for fg=${JSON.stringify(fg)} bg=${JSON.stringify(bg)}`);
			}
			worstRatio = Math.min(worstRatio, ratio);
		}
		// Hue must survive; that is the whole point of solving in OKLCH.
		// Reported per chroma band, because hue is not meaningfully defined for
		// a near-grey and 8-bit rounding moves it by degrees there for free.
		if (out !== fg) {
			const a = rgbToOklch(fg);
			const b = rgbToOklch(out);
			const C = Math.min(a.C, b.C);
			let d = Math.abs(a.h - b.h);
			if (d > 0.5) d = 1 - d;
			for (const [lo, label] of BANDS) {
				if (C > lo) bandDrift.set(label, Math.max(bandDrift.get(label) ?? 0, d));
			}
			if (C > 0.05) hueDrift = Math.max(hueDrift, d);
		}
	}
	console.log(`2. contrast floor: ${checked} pairs, worst achieved ratio ${worstRatio.toFixed(4)}`);
	for (const [, label] of BANDS) {
		const d = bandDrift.get(label) ?? 0;
		console.log(`   max hue drift ${label.padEnd(26)} ${d.toFixed(5)} turns = ${(d * 360).toFixed(2)} deg`);
	}
	// A degree or two is 8-bit quantisation and is invisible; a palette shifting
	// by a visible amount would mean the gamut mapping is wrong again.
	if (hueDrift > 0.015) fail(`hue drifted by ${(hueDrift * 360).toFixed(1)} deg above C=0.05`);
}

// 3. The memo must be keyed correctly: same input twice, same answer; and a
//    neighbouring pair must not collide with it.
{
	let mismatches = 0;
	for (let i = 0; i < 5000; i++) {
		const fg = { r: i % 256, g: (i * 3) % 256, b: (i * 7) % 256 };
		const bg = { r: (i * 11) % 256, g: (i * 17) % 256, b: (i * 23) % 256 };
		const a = ensureContrast(fg, bg, 3.2);
		const b = ensureContrast({ ...fg }, { ...bg }, 3.2);
		if (a.r !== b.r || a.g !== b.g || a.b !== b.b) mismatches++;
	}
	console.log(`3. memo determinism: ${mismatches} mismatches in 5000 repeats`);
	if (mismatches) fail(`${mismatches} memo mismatches`);
}

// 4. Pass-through must preserve object identity, or the engine marks every
//    cell dirty and the render cost goes up instead of down.
{
	const fg = { r: 250, g: 250, b: 255 };
	const bg = { r: 10, g: 10, b: 14 };
	const out = ensureContrast(fg, bg, 3.2);
	console.log(`4. pass-through identity preserved: ${out === fg}`);
	if (out !== fg) fail("pass-through returned a new object");
}

// 5. How often the solver actually runs for the benchmark's colour sets.
//    A speedup means nothing if the fast case is fast because it does no work,
//    so the benchmark's own assumptions get checked here.
{
	const bg = { r: 18, g: 18, b: 24 };
	const sets = {
		"x1 colour": (i) => ({ r: 30, g: 28, b: 34 }),
		"x32 colours": (i) => ({ r: 28 + (i % 32), g: 28, b: 34 }),
		"all distinct": (i) => ({
			r: 20 + (i % 40),
			g: 20 + ((i >> 5) % 40),
			b: 26 + ((i >> 10) % 40),
		}),
	};
	console.log("\n5. solver engagement over 3200 cells (how many cells need solving):");
	for (const [name, gen] of Object.entries(sets)) {
		let solved = 0;
		const distinct = new Set();
		for (let i = 0; i < 3200; i++) {
			const fg = gen(i);
			distinct.add((fg.r << 16) | (fg.g << 8) | fg.b);
			if (ensureContrast(fg, bg, 3.2) !== fg) solved++;
		}
		const pct = ((solved / 3200) * 100).toFixed(1);
		console.log(`   ${name.padEnd(14)} ${solved}/3200 need solving (${pct}%), ${distinct.size} distinct colours`);
	}
}

console.log(failures ? `\n${failures} FAILURES` : "\nall checks passed");
process.exit(failures ? 1 : 0);
