import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { allFx } from "../extensions/rainbow/fx.js";
import { DEFAULT_SETTINGS, type RainbowSettings } from "../extensions/rainbow/settings.js";
import { showRainbowSettingsDialog } from "../extensions/rainbow/settings-dialog.js";

const plain = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");
type Component = { render(width: number): string[]; handleInput(data: string): void; dispose(): void };
type Factory = (
	tui: { terminal: { rows: number }; requestRender(): void },
	theme: { fg(role: string, text: string): string; bold(text: string): string },
	keybindings: unknown,
	done: () => void,
) => Component;
function open(initial: RainbowSettings = { ...DEFAULT_SETTINGS, fx: {} }) {
	let component!: Component;
	let finish!: () => void;
	let renders = 0;
	let completions = 0;
	const terminal = { rows: 24 };
	const patches: Partial<RainbowSettings>[] = [];
	const pending = showRainbowSettingsDialog({ ui: {
		custom: (factory: Factory) => new Promise<void>((resolve) => {
			finish = resolve;
			component = factory({ terminal, requestRender: () => renders++ },
				{ fg: (_: string, text: string) => text, bold: (text: string) => text }, null,
				() => { completions++; resolve(); });
		}),
	} }, initial, (patch) => patches.push(patch));
	return { component, terminal, pending, finish: () => finish(), patches,
		renders: () => renders, completions: () => completions };
}
function select(dialog: ReturnType<typeof open>, label: string) {
	for (let i = 0; i < 100; i++) {
		if (dialog.component.render(80).some((line) => plain(line).includes(`▸ ${label.padEnd(15)} `))) return;
		dialog.component.handleInput("\x1b[B");
	}
	assert.fail(`Cannot reach ${label}`);
}

test("all registry FX are scrollable, toggled at defaults, adjusted live and reset without mutation", async () => {
	const initial = { ...DEFAULT_SETTINGS, fx: { shine: 0.25 } };
	const d = open(initial);
	try {
		assert.ok(allFx().length >= 34); // Cover the complete registry, not a hard-coded list.
		for (const fx of allFx()) {
			select(d, fx.id);
			d.component.handleInput(" ");
			assert.equal(d.patches.at(-1)?.fx?.[fx.id], fx.id === "shine" ? undefined : fx.defaultIntensity);
			assert.ok(d.component.render(80).length <= 24);
		}
		select(d, "box strength");
		d.component.handleInput("\x1b[C");
		assert.equal(d.patches.at(-1)?.boxBlend, 0.2);
		for (let i = 0; i < 20; i++) d.component.handleInput("\x1b[C");
		assert.equal(d.patches.at(-1)?.boxBlend, 1);
		assert.ok(d.component.render(80).some((line) => plain(line).includes("100%")));
		select(d, "shine");
		d.component.handleInput("\x1b[C");
		assert.equal(d.patches.at(-1)?.fx?.shine, 0.05);
		for (let i = 0; i < 30; i++) d.component.handleInput("\x1b[C");
		assert.equal(d.patches.at(-1)?.fx?.shine, 1);
		for (let i = 0; i < 30; i++) d.component.handleInput("\x1b[D");
		assert.equal(d.patches.at(-1)?.fx?.shine, undefined);
		d.component.handleInput("r");
		assert.deepEqual(d.patches.at(-1)?.fx, initial.fx);
		assert.equal(d.patches.at(-1)?.boxBlend, initial.boxBlend);
		assert.deepEqual(initial.fx, { shine: 0.25 });
		for (const height of [10, 24, 40, 60]) {
			d.terminal.rows = height;
			for (const width of [12, 40, 72, 80, 160]) {
				const lines = d.component.render(width);
				assert.equal(lines.length, Math.min(24, height - 2));
				assert.ok(lines.every((line) => visibleWidth(line) <= Math.min(72, width)));
				assert.ok(plain(lines.at(-1) ?? "").startsWith("╰"));
				assert.ok(lines.some((line) => plain(line).includes("▸")));
			}
		}
	} finally { d.component.handleInput("\x1b"); await d.pending; }
});

test("actual engine preview animates, follows enabled state and stops its timer on close", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
	const d = open();
	const first = d.component.render(80);
	assert.ok(plain(first.join("\n")).includes("Outline"));
	assert.ok(plain(first.join("\n")).includes("Filled tool"));
	assert.ok(first.join("\n").includes("\x1b[38;2;"));
	t.mock.timers.tick(1000);
	assert.ok(d.renders() > 0);
	assert.notDeepEqual(d.component.render(80), first);
	d.component.handleInput(" "); // master off
	const disabled = d.component.render(80).slice(2, 7);
	t.mock.timers.tick(1000);
	assert.deepEqual(d.component.render(80).slice(2, 7), disabled);
	d.component.handleInput("\x1b");
	const count = d.renders();
	t.mock.timers.tick(1000);
	assert.equal(d.renders(), count);
	d.component.dispose();
	assert.equal(d.completions(), 1);
	await d.pending;
});

test("palette edits recolour existing preview boxes without reopening", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
	const d = open({ ...DEFAULT_SETTINGS, fx: {}, speed: 0, motion: "none", presetFade: 0 });
	try {
		select(d, "palette");
		const before = d.component.render(80).slice(2, 6);
		d.component.handleInput("\x1b[C");
		assert.notEqual(d.patches.at(-1)?.preset, DEFAULT_SETTINGS.preset);
		const after = d.component.render(80).slice(2, 6);
		assert.deepEqual(after.map(plain), before.map(plain));
		for (let i = 0; i < before.length; i++) assert.notEqual(after[i], before[i]);
		d.component.handleInput("r");
		assert.deepEqual(d.component.render(80).slice(2, 6), before);
	} finally { d.component.handleInput("\x1b"); await d.pending; }
});

test("external disposal stops preview without completing twice", async (t) => {
	t.mock.timers.enable({ apis: ["setInterval"] });
	const d = open();
	d.component.dispose();
	d.component.dispose();
	t.mock.timers.tick(1000);
	assert.equal(d.renders(), 0);
	assert.equal(d.completions(), 0);
	d.finish();
	await d.pending;
});
