/**
 * Headless preview harness.
 *
 * Builds a synthetic "pi fullscreen" screen — header, chat, tool call, footer,
 * editor box — and runs it through the engine, so effects can be developed,
 * benchmarked and screenshotted without launching a real session.
 */

import { RainbowEngine } from "./engine.js";
import { GRADIENT_MODES, MOTION_MODES } from "./field.js";
import { allFx } from "./fx.js";
import { PRESETS } from "./presets.js";
import { type RainbowSettings, DEFAULT_SETTINGS, getBundle, normalizeSettings } from "./settings.js";

const ESC = "\u001b[";
const R = `${ESC}0m`;
const dim = (s: string) => `${ESC}2m${s}${R}`;
const bold = (s: string) => `${ESC}1m${s}${R}`;
const fg = (n: number, s: string) => `${ESC}38;5;${n}m${s}${R}`;

/** A believable pi session, rendered as plain styled lines. */
export function sampleScreen(width: number, height: number): string[] {
	const w = Math.max(40, width);
	const lines: string[] = [];
	const rule = (ch: string) => dim(ch.repeat(w - 2));

	lines.push(` ${bold(fg(213, "pi"))} ${dim("·")} ${fg(252, "rainbow")} ${dim("·")} ${fg(244, "claude-opus-5")}`);
	lines.push(` ${rule("─")}`);
	lines.push("");
	lines.push(` ${fg(114, "▌")} ${fg(252, "make the terminal do something ridiculous")}`);
	lines.push("");
	lines.push(` ${fg(110, "●")} ${fg(252, "Sure. I am going to repaint every cell of this screen")}`);
	lines.push(`   ${fg(252, "through an OKLab gradient and then drop about thirty")}`);
	lines.push(`   ${fg(252, "layers of particles and post-processing on top of it.")}`);
	lines.push("");
	lines.push(`   ${dim("┌─")} ${fg(179, "bash")} ${dim("─────────────────────────────")}`);
	lines.push(`   ${dim("│")} ${fg(244, "$ npm run build")}`);
	lines.push(`   ${dim("│")} ${fg(108, "✓")} ${fg(244, "34 effects registered")}`);
	lines.push(`   ${dim("│")} ${fg(108, "✓")} ${fg(244, "68 palettes, 16 fields, 8 motions")}`);
	lines.push(`   ${dim("└─────────────────────────────────────")}`);
	lines.push("");
	lines.push(`   ${fg(252, "It renders at 24fps and backs off automatically when")}`);
	lines.push(`   ${fg(252, "a frame starts costing more than it is worth.")}`);
	lines.push("");
	lines.push(` ${fg(114, "▌")} ${fg(252, "show me")}`);
	lines.push("");

	while (lines.length < height - 5) lines.push("");

	lines.push(` ${dim("╭" + "─".repeat(Math.max(2, w - 4)) + "╮")}`);
	lines.push(` ${dim("│")} ${fg(252, "›")} ${fg(244, "/rainbow-bundle synthwave")}${" ".repeat(Math.max(0, w - 32))}${dim("│")}`);
	lines.push(` ${dim("╰" + "─".repeat(Math.max(2, w - 4)) + "╯")}`);
	lines.push(` ${dim("main")} ${dim("·")} ${dim("12.4k/200k")} ${dim("·")} ${fg(141, "◆ rainbow")}`);

	return lines.slice(0, height);
}

/** Alternative content: a code-review-ish screen, denser text. */
export function sampleCodeScreen(width: number, height: number): string[] {
	const w = Math.max(40, width);
	const lines: string[] = [];
	lines.push(` ${bold(fg(213, "pi"))} ${dim("·")} ${fg(244, "extensions/rainbow/fx-post.ts")}`);
	lines.push(` ${dim("─".repeat(w - 2))}`);
	const code: [number, string][] = [
		[244, "const neon: FxLayer = {"],
		[244, "    id: \"neon\","],
		[244, "    name: \"Neon Sign\","],
		[244, "    group: \"post\","],
		[244, "    apply(ctx, k) {"],
		[244, "        eachCell(ctx.frame, (cell, row) => {"],
		[244, "            if (!isText(cell)) return;"],
		[244, "            const base = cell.outFg ?? ctx.tuning.fg;"],
		[244, "            cell.outFg = screenBlend(base, scale(base, k));"],
		[244, "            cell.outBold = cell.outBold || k > 0.55;"],
		[244, "            row.dirty = true;"],
		[244, "        });"],
		[244, "    },"],
		[244, "};"],
	];
	for (let i = 0; i < code.length; i++) {
		const [c, text] = code[i]!;
		lines.push(` ${dim(String(i + 1).padStart(3))} ${fg(c, text)}`);
	}
	while (lines.length < height) lines.push("");
	return lines.slice(0, height);
}

export type PreviewOptions = {
	width?: number;
	height?: number;
	frames?: number;
	fps?: number;
	/** Start time offset, so successive stills are not identical. */
	t0?: number;
	content?: string[];
};

/** Render N frames of a given settings object. Returns frames of screen lines. */
export function renderFrames(settings: Partial<RainbowSettings>, opts: PreviewOptions = {}): string[][] {
	const width = opts.width ?? 100;
	const height = opts.height ?? 32;
	const frames = opts.frames ?? 1;
	const fps = opts.fps ?? 24;
	const s = normalizeSettings({ ...DEFAULT_SETTINGS, ...settings });
	const engine = new RainbowEngine(s);
	const content = opts.content ?? sampleScreen(width, height);

	// Warm the engine so time-based effects are past their first frame.
	const out: string[][] = [];
	const warm = Math.max(0, Math.round((opts.t0 ?? 0) * fps));
	for (let i = 0; i < warm + frames; i++) {
		const rendered = engine.process(content, {
			width,
			height,
			fullscreen: true,
			cursor: { x: 24, y: height - 3 },
			overlayVisible: false,
		});
		if (i >= warm) out.push(rendered);
	}
	return out;
}

/** One still frame as a single string, ready to print or screenshot. */
export function renderStill(settings: Partial<RainbowSettings>, opts: PreviewOptions = {}): string {
	const [frame] = renderFrames(settings, { ...opts, frames: 1 });
	return (frame ?? []).join("\n");
}

/** A compact catalogue of everything available, for `--list`. */
export function catalogue(): string {
	const out: string[] = [];
	out.push(`palettes (${PRESETS.length}):`);
	for (const p of PRESETS) out.push(`  ${p.id.padEnd(18)} ${p.name.padEnd(22)} ${p.blurb}`);
	out.push("");
	out.push(`gradient fields (${GRADIENT_MODES.length}):`);
	for (const m of GRADIENT_MODES) out.push(`  ${m.id.padEnd(18)} ${m.blurb}`);
	out.push("");
	out.push(`motion (${MOTION_MODES.length}):`);
	for (const m of MOTION_MODES) out.push(`  ${m.id.padEnd(18)} ${m.blurb}`);
	out.push("");
	const fx = allFx();
	out.push(`effects (${fx.length}):`);
	for (const f of fx) out.push(`  ${f.id.padEnd(18)} [${f.group}] ${f.blurb}`);
	return out.join("\n");
}

/* ------------------------------------------------------------------ *
 * CLI: node dist/preview.js [bundle|preset] [--frames N] [--list]
 * ------------------------------------------------------------------ */

export async function previewMain(argv: string[]): Promise<void> {
	const args = argv.slice(2);
	if (args.includes("--list")) {
		process.stdout.write(`${catalogue()}\n`);
		return;
	}

	const flag = (name: string, fallback: number): number => {
		const i = args.indexOf(`--${name}`);
		if (i < 0) return fallback;
		const v = Number(args[i + 1]);
		return Number.isFinite(v) ? v : fallback;
	};

	const positional = args.filter((a) => !a.startsWith("--") && !/^\d+(\.\d+)?$/.test(a));
	const name = positional[0] ?? "default";
	const bundle = getBundle(name);
	const settings: Partial<RainbowSettings> = bundle ? bundle.settings : { preset: name };

	const width = flag("width", Math.min(120, process.stdout.columns || 100));
	const height = flag("height", Math.min(40, (process.stdout.rows || 32) - 1));
	const frames = flag("frames", 1);
	const fps = flag("fps", 24);
	const t0 = flag("t0", 0);

	const list = renderFrames(settings, { width, height, frames, fps, t0 });

	// --out-dir writes one file per frame, for the screenshot/GIF tooling.
	const outIdx = args.indexOf("--out-dir");
	if (outIdx >= 0 && args[outIdx + 1]) {
		const dir = args[outIdx + 1]!;
		const { mkdir, writeFile } = await import("node:fs/promises");
		await mkdir(dir, { recursive: true });
		await Promise.all(
			list.map((frame, i) =>
				writeFile(`${dir}/frame-${String(i).padStart(4, "0")}.ans`, `${frame.join("\n")}\u001b[0m\n`),
			),
		);
		process.stdout.write(`${list.length} frames -> ${dir}\n`);
		return;
	}

	if (frames === 1) {
		process.stdout.write(`${list[0]!.join("\n")}\u001b[0m\n`);
		return;
	}
	// Animate in place.
	process.stdout.write("\u001b[?1049h\u001b[?25l");
	try {
		for (const frame of list) {
			process.stdout.write(`\u001b[H${frame.join("\u001b[K\r\n")}\u001b[0m`);
			await new Promise((r) => setTimeout(r, 1000 / fps));
		}
	} finally {
		process.stdout.write("\u001b[?25h\u001b[?1049l");
	}
}
