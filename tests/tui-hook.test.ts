import assert from "node:assert/strict";
import test from "node:test";
import { RainbowTuiHook } from "../extensions/rainbow/tui-hook.js";
import { RainbowEngine } from "../extensions/rainbow/engine.js";
import { DEFAULT_SETTINGS } from "../extensions/rainbow/settings.js";

const settings = { ...DEFAULT_SETTINGS, speed: 0, fx: {}, presetFade: 0, motion: "none" as const };

function fixture() {
	const listeners = new Set<(scheme: unknown) => void>();
	const tui = {
		mode: "fullscreen", terminal: { columns: 40, rows: 4 },
		output: [] as string[], requests: [] as (boolean | undefined)[],
		applyLineResets(lines: string[]) { return lines.map((line) => line + "\x1b[0m"); },
		doRender() { this.output = this.applyLineResets(["box"]); },
		requestRender(force?: boolean) { this.requests.push(force); },
		onTerminalColorSchemeChange(listener: (scheme: unknown) => void) {
			listeners.add(listener);
			return () => { listeners.delete(listener); };
		},
	};
	return { tui, listeners };
}
function owner(label: string) {
	let calls = 0;
	const engine = { process: (lines: string[]) => { calls++; return lines.map((line) => label + line); }, setTheme() {}, settlePalette() {}, idleSeconds: 0 } as unknown as RainbowEngine;
	const hook = new RainbowTuiHook({ engine, getSettings: () => settings });
	return { hook, calls: () => calls };
}

test("reload transfers wrappers and theme subscription; stale disposal cannot remove new owner", () => {
	const { tui, listeners } = fixture();
	const old = owner("old"), next = owner("next");
	try {
		old.hook.attach(tui);
		tui.doRender();
		next.hook.attach(tui);
		assert.equal(old.hook.attached, false);
		assert.equal(listeners.size, 1);
		old.hook.dispose();
		tui.doRender();
		assert.match(tui.output[0]!, /^nextbox/);
		assert.equal(old.calls(), 1);
		assert.equal(next.calls(), 1);
		next.hook.attach(tui);
		tui.doRender();
		assert.equal(next.calls(), 2, "same-owner attach must not stack wrappers");
		assert.equal(listeners.size, 1);
	} finally { old.hook.dispose(); next.hook.dispose(); }
	assert.equal(listeners.size, 0);
	tui.doRender();
	assert.equal(tui.output[0], "box\x1b[0m");
});

test("suspension bypasses independently colored preview and refreshes on resume", () => {
	const { tui } = fixture();
	const { hook, calls } = owner("rainbow");
	try {
		hook.attach(tui);
		hook.setSuspended(true);
		tui.doRender();
		assert.equal(calls(), 0);
		assert.equal(hook.fps, 0);
		assert.equal(tui.output[0], "box\x1b[0m");
		hook.setSuspended(false);
		tui.doRender();
		assert.equal(calls(), 1);
		assert.deepEqual(tui.requests, [true, true]);
	} finally { hook.dispose(); }
});

test("moving to another TUI restores the old one; non-render scrollback stays raw", () => {
	const first = fixture(), second = fixture();
	const { hook, calls } = owner("rainbow");
	try {
		hook.attach(first.tui);
		hook.attach(second.tui);
		first.tui.doRender();
		assert.equal(calls(), 0);
		assert.equal(first.listeners.size, 0);
		assert.equal(second.tui.applyLineResets(["scrollback"])[0], "scrollback\x1b[0m");
		assert.equal(calls(), 0);
		second.tui.doRender();
		assert.equal(calls(), 1);
	} finally { hook.dispose(); }
});

// The installed npm peer may predate the host's TuiAltScreen API. Set
// PI_TUI_TEST_MODULE to the actual host dist/index.js to run this integration.
test("actual host fullscreen diff recolors cached boxes after palette change and reload", async (t) => {
	let host;
	try {
		host = await import(process.env.PI_TUI_TEST_MODULE ?? "@earendil-works/pi-tui");
	} catch (error) {
		if (process.env.PI_TUI_TEST_MODULE || (error as NodeJS.ErrnoException).code !== "ERR_MODULE_NOT_FOUND") throw error;
		t.skip("host pi-tui unavailable; set PI_TUI_TEST_MODULE to its dist/index.js");
		return;
	}
	assert.equal(typeof host.TuiAltScreen, "function");
	const writes: string[] = [];
	const tui = new host.TuiAltScreen({ columns: 40, rows: 4, write: (data: string) => writes.push(data) });
	// Exercise real doRender/layout/composition/reset/diff, without starting a
	// terminal or installing input listeners in the node test process.
	tui.altScreenActive = true;
	const cached = ["\x1b[48;2;28;30;38m" + " tool result ".padEnd(40) + "\x1b[0m", "─".repeat(40)];
	tui.addChild({ render: () => cached, invalidate() {} });
	let current = { ...settings, presetFade: 0.8, preset: "pastel" };
	const engine = new RainbowEngine(current);
	const hook = new RainbowTuiHook({ engine, getSettings: () => current });
	const nextSettings = { ...current, preset: "neon" };
	const nextEngine = new RainbowEngine(nextSettings);
	const nextHook = new RainbowTuiHook({ engine: nextEngine, getSettings: () => nextSettings });
	try {
		hook.attach(tui);
		tui.doRender();
		const before = [...tui.previousScreen];
		current = nextSettings;
		engine.updateSettings(current);
		hook.refresh(); // No pump: the normal 0.8s fade must settle immediately.
		tui.doRender();
		const changed = [...tui.previousScreen];
		assert.notEqual(changed[0], before[0], "box must recolor despite cached component lines");
		assert.ok(writes.at(-1)!.includes(changed[0]!));
		assert.equal(cached[0]!.includes("\x1b[48;2;28;30;38m"), true);
		// Different settings ensure stale-engine capture is visible, not merely
		// a bookkeeping assertion. No host cache invalidation or restart needed.
		current = { ...settings, presetFade: 0, preset: "pastel" };
		engine.updateSettings(current);
		nextHook.attach(tui);
		tui.doRender();
		assert.deepEqual(tui.previousScreen, changed);
		assert.equal(nextEngine.getStats().frames, 1);
		hook.dispose();
		tui.doRender();
		assert.deepEqual(tui.previousScreen, changed);
		assert.equal(nextEngine.getStats().frames, 2);
	} finally { hook.dispose(); nextHook.dispose(); tui.stopped = true; }
});
