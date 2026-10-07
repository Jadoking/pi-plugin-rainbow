import assert from "node:assert/strict";
import test from "node:test";

import { parseAnsiLine } from "../extensions/rainbow/ansi-grid.js";
import { contrastRatio } from "../extensions/rainbow/color.js";
import { RainbowEngine } from "../extensions/rainbow/engine.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "../extensions/rainbow/settings.js";
import { MOTION_MODES } from "../extensions/rainbow/field.js";
import { allFx } from "../extensions/rainbow/fx.js";

const width = 80;
const box = (text: string) => `\x1b[48;2;28;30;38m${text.padEnd(width)}\x1b[0m`;
const lines = [
	"Assistant prose stays unchanged.",
	"",
	box(""),
	box(" bash npm run build"),
	box(" build complete"),
	box(""),
	"",
	"─".repeat(width),
	" > Next request",
	"─".repeat(width),
	"Footer stays unchanged.",
];

test("box edges and interiors retain a horizontal background gradient", () => {
	const engine = new RainbowEngine({
		...DEFAULT_SETTINGS,
		mode: "horizontal",
		motion: "none",
		fx: {},
	});
	const output = engine.process(lines, { width, height: lines.length, fullscreen: true });
	for (const y of [2, 3, 4, 5]) {
		const cells = parseAnsiLine(output[y]!).cells;
		const backgrounds = new Set(cells.map((cell) => cell.bgCode));
		assert.ok(backgrounds.size > 8, `row ${y}: expected a gradient, got ${backgrounds.size} background colour(s)`);
		for (const cell of cells) {
			if (!cell.text.trim()) continue;
			assert.ok(cell.fg && cell.bg);
			assert.ok(contrastRatio(cell.fg, cell.bg) >= DEFAULT_SETTINGS.minContrast - 0.05);
		}
	}
	assert.equal(output[8], lines[8]);
	assert.notEqual(output[0], lines[0]);
	assert.ok(parseAnsiLine(output[0]!).cells.every((cell) => cell.bgCode === null));
	assert.equal(output[10], lines[10]);
	for (const y of [7, 9]) {
		assert.ok(parseAnsiLine(output[y]!).cells.every((cell) => cell.bgCode === null));
	}
});

test("panels colours prose and boxes without painting empty screen areas", () => {
	for (const fx of [{}, DEFAULT_SETTINGS.fx, Object.fromEntries(allFx().map((effect) => [effect.id, 1]))]) {
		const engine = new RainbowEngine({ ...DEFAULT_SETTINGS, scope: "panels", fx, motion: "none" });
		const output = engine.process(lines, { width, height: lines.length, fullscreen: true });
		const prose = parseAnsiLine(output[0]!).cells;
		assert.ok(new Set(prose.filter((cell) => cell.text.trim()).map((cell) => cell.fgCode)).size > 8);
		assert.ok(prose.every((cell) => cell.bgCode === null));
		assert.equal(prose.map((cell) => cell.text).join("").trimEnd(), lines[0]);
		for (const y of [1, 6, 8, 10]) assert.equal(output[y], lines[y]);
		assert.ok(parseAnsiLine(output[3]!).cells.every((cell) => cell.bgCode !== null));
	}
});

test("editor content stays untouched in every scope, including multiline input", () => {
	const input = ["\x1b[38;2;220;220;220m > Next request\x1b[0m", "   another line", ""];
	const screen = [...lines.slice(0, 8), ...input, ...lines.slice(9)];
	for (const scope of ["panels", "screen", "text", "chrome"] as const) {
		const engine = new RainbowEngine({ ...DEFAULT_SETTINGS, scope, motion: "none" });
		const output = engine.process(screen, { width, height: screen.length, fullscreen: true });
		assert.deepEqual(output.slice(8, 8 + input.length), input);
		for (const y of [7, 8 + input.length]) {
			const colors = new Set(parseAnsiLine(output[y]!).cells.map((cell) => cell.fgCode));
			assert.ok(colors.size > 8, `${scope}: editor border must retain its gradient`);
		}
	}
});

test("reactive pulses and speed changes do not jump the animation phase", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	for (const { id: motion } of MOTION_MODES) {
		const settings = { ...DEFAULT_SETTINGS, motion, mode: "radial" as const, fx: {} };
		const engine = new RainbowEngine(settings);
		const render = () => engine.process(lines, { width, height: lines.length, fullscreen: true });
		render();
		t.mock.timers.tick(123_456);
		const before = render();
		engine.pulse(0.6);
		assert.ok(render().every((line, y) => line === before[y]), `${motion}: activity changed position without elapsed time`);
		engine.updateSettings({ ...settings, speed: 0 });
		assert.ok(render().every((line, y) => line === before[y]), `${motion}: stopping reset the position`);
		engine.updateSettings({ ...settings, speed: 0.4 });
		assert.ok(render().every((line, y) => line === before[y]), `${motion}: speed change reset the position`);
	}
});

test("gradient advances by elapsed time, not frame count, and pauses at zero speed", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const settings = { ...DEFAULT_SETTINGS, motion: "scroll" as const, reactive: false, fx: {} };
	const fast = new RainbowEngine(settings);
	const slow = new RainbowEngine(settings);
	const render = (engine: RainbowEngine) => engine.process(lines, { width, height: lines.length, fullscreen: true });
	const initial = render(fast);
	render(slow);
	for (let i = 0; i < 10; i++) {
		t.mock.timers.tick(100);
		render(fast);
	}
	const advanced = render(fast);
	assert.notDeepEqual(advanced, initial);
	assert.deepEqual(render(slow), advanced);
	fast.updateSettings({ ...settings, speed: 0 });
	t.mock.timers.tick(5_000);
	assert.deepEqual(render(fast), advanced);
});

test("box edges and interior use the same foreground and background tint", () => {
	const screen = Array.from({ length: 4 }, () => box(" same content"));
	const engine = new RainbowEngine({ ...DEFAULT_SETTINGS, mode: "horizontal", motion: "none", fx: {} });
	const output = engine.process(screen, { width, height: screen.length, fullscreen: true });
	for (const row of output) assert.equal(row, output[1]);
});

test("palette changes recolour existing boxes to the same result as a fresh engine", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const settings = { ...DEFAULT_SETTINGS, motion: "none" as const, reactive: false, fx: {} };
	const engine = new RainbowEngine(settings);
	const render = (e: RainbowEngine) => e.process(lines, { width, height: lines.length, fullscreen: true });
	const before = render(engine);
	const changed = { ...settings, preset: "dracula" };
	engine.updateSettings(changed);
	t.mock.timers.tick(1000);
	const after = render(engine);
	assert.notEqual(after[3], before[3]);
	assert.deepEqual(after, render(new RainbowEngine(changed)));
});

test("effects reach filled and outlined side boxes without painting adjacent prose", (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
	const screen = [
		"Prose stays readable.   ╭────────────────────────────────╮",
		"More prose.             │                                │",
		"Outside the box.        │ Status                         │",
		"                        ╰────────────────────────────────╯",
		...Array.from({ length: 8 }, () => box(" box text")),
		"─".repeat(width), " > input", "─".repeat(width), "footer",
	];
	const render = (fx: Record<string, number>) => new RainbowEngine({
		...DEFAULT_SETTINGS, fx, reactive: false, chaos: 1, frameBudgetMs: 0,
		motion: "none", minContrast: 1,
	}).process(screen, { width, height: screen.length, fullscreen: true });
	const plain = render({});
	for (const id of ["plasmafield", "neon", "rain"]) {
		const output = render({ [id]: 1 });
		assert.notDeepEqual(output.slice(4, 12), plain.slice(4, 12));
		for (const y of [0, 1, 2]) {
			const cells = parseAnsiLine(output[y]!).cells;
			assert.deepEqual(cells.slice(0, 24), parseAnsiLine(plain[y]!).cells.slice(0, 24));
		}
		assert.equal(output[13], screen[13]);
		assert.equal(output[15], screen[15]);
	}
	const plasma = render({ plasmafield: 1 });
	assert.notEqual(plasma[1], plain[1], "outlined box interior receives background effects");
});

test("box strength reaches pastel RGB independently of text blend and preserves contrast", () => {
	const pastel = { r: 255, g: 204, b: 221 };
	const screen = [box(" Readable text"), "╭──────────────╮", "│ Readable text│", "╰──────────────╯", "Outside prose"];
	for (const blend of [0, 0.85, 1]) {
		const settings = normalizeSettings({ ...DEFAULT_SETTINGS, preset: "#ffccdd,#ffccdd",
			boxBlend: 1, blend, motion: "none", fx: {} });
		const engine = new RainbowEngine(settings);
		const render = () => engine.process(screen, { width, height: screen.length, fullscreen: true });
		const output = render();
		for (const y of [0, 2]) {
			for (const cell of parseAnsiLine(output[y]!).cells.slice(1, 14)) {
				assert.deepEqual(cell.bg, pastel);
				if (cell.text.trim()) assert.ok(cell.fg && contrastRatio(cell.fg, pastel) >= settings.minContrast - 0.05);
			}
		}
		assert.ok(parseAnsiLine(output[4]!).cells.every((cell) => cell.bg === null));
		engine.updateSettings({ ...settings, boxBlend: 0 });
		const untinted = render();
		for (const y of [0, 2]) assert.deepEqual(
			parseAnsiLine(untinted[y]!).cells.slice(0, parseAnsiLine(screen[y]!).cells.length).map((cell) => cell.bg),
			parseAnsiLine(screen[y]!).cells.map((cell) => cell.bg),
		);
	}
	assert.equal(normalizeSettings({ boxBlend: -1 }).boxBlend, 0);
	assert.equal(normalizeSettings({ boxBlend: 2 }).boxBlend, 1);
	assert.equal(normalizeSettings({ boxBlend: NaN }).boxBlend, DEFAULT_SETTINGS.boxBlend);
	assert.equal(normalizeSettings({}).boxBlend, DEFAULT_SETTINGS.boxBlend);
	assert.equal(normalizeSettings(JSON.parse(JSON.stringify({ boxBlend: 0.7 }))).boxBlend, 0.7);
});

test("background opt-out and text scope preserve original box fills", () => {
	for (const settings of [{ colorBackground: false }, { scope: "text" as const }]) {
		const engine = new RainbowEngine({ ...DEFAULT_SETTINGS, ...settings, fx: {}, motion: "none" });
		const output = engine.process(lines, { width, height: lines.length, fullscreen: true });
		for (const y of [2, 3, 4, 5]) {
			assert.deepEqual(
				parseAnsiLine(output[y]!).cells.map((cell) => cell.bg),
				parseAnsiLine(lines[y]!).cells.map((cell) => cell.bg),
			);
		}
	}
});
