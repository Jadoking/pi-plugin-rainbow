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
import { SCOPES } from "./layout.js";

const ESC = "\u001b[";
const R = `${ESC}0m`;
const dim = (s: string) => `${ESC}2m${s}${R}`;
const bold = (s: string) => `${ESC}1m${s}${R}`;
const fg = (n: number, s: string) => `${ESC}38;5;${n}m${s}${R}`;

/**
 * A believable pi session.
 *
 * Laid out the way pi actually draws: there are no corner-drawn boxes, just
 * full-width horizontal rules separating the transcript from the editor and the
 * footer, with another rule introducing each tool call. The `panels` scope
 * keys off exactly those rules, so the preview has to get them right.
 */
const TOOL_OUTPUT = [
	"34 effects registered across 4 groups",
	"81 palettes · 16 gradient fields · 8 motion modes",
	"8 motion modes · 4 scopes",
	"build complete in 1.9s",
];

const TYPED = "/rainbow-scope panels";

export function sampleScreen(width: number, height: number, t?: number): string[] {
	const w = Math.max(40, width);
	const lines: string[] = [];
	const rule = () => dim("─".repeat(w));
	const pad = (left: string, right: string) => {
		const gap = Math.max(1, w - visible(left) - visible(right));
		return left + " ".repeat(gap) + right;
	};

	// A looping 9-second "session": the tool call opens, streams output, closes,
	// the answer arrives, and the next prompt is typed. Without this the video is
	// a static screen with a gradient crawling over it, which proves nothing
	// about panels appearing and disappearing as pi works.
	const scripted = t !== undefined;
	const beat = scripted ? (t % 9) : 9;
	const toolOpen = !scripted || beat > 1.2;
	const toolLines = !scripted ? TOOL_OUTPUT.length : Math.max(0, Math.min(TOOL_OUTPUT.length, Math.floor((beat - 1.4) / 0.55)));
	const toolDone = !scripted || beat > 4.2;
	const answered = !scripted || beat > 4.8;
	const typedN = !scripted ? TYPED.length : Math.max(0, Math.min(TYPED.length, Math.round((beat - 5.6) / 0.09)));

	lines.push(` ${fg(114, "▌")} ${fg(252, "make the terminal do something ridiculous")}`);
	lines.push("");
	lines.push(` ${fg(252, "Sure. I am going to repaint every cell of this screen through an")}`);
	lines.push(` ${fg(252, "OKLab gradient, then drop particles and post-processing on top.")}`);
	lines.push("");

	// A tool call: pi introduces one with a rule, then the tool name + output.
	if (toolOpen) {
		lines.push(rule());
		lines.push(` ${bold(fg(179, "bash"))} ${dim("npm run build")}${toolDone ? "" : dim("  ⋯")}`);
		for (let i = 0; i < toolLines; i++) {
			lines.push(` ${fg(108, "✓")} ${fg(244, TOOL_OUTPUT[i]!)}`);
		}
		if (toolDone) lines.push(` ${dim("… 12 more lines, ctrl+r to expand")}`);
		lines.push(rule());
		lines.push("");
	}
	if (answered) {
		lines.push(` ${fg(252, "It renders at 24fps and backs off automatically when a frame")}`);
		lines.push(` ${fg(252, "starts costing more than it is worth.")}`);
		lines.push("");
		lines.push(` ${fg(114, "▌")} ${fg(252, "scope it to the boxes instead of the whole background")}`);
		lines.push("");
	}

	while (lines.length < height - 5) lines.push("");

	// Editor: rule, input line, rule, footer — pi's real bottom chrome.
	const caret = scripted && typedN < TYPED.length && Math.floor(beat * 3) % 2 === 0 ? "▏" : "";
	lines.push(rule());
	lines.push(` ${fg(252, "›")} ${fg(244, TYPED.slice(0, typedN))}${caret}`);
	lines.push(rule());
	lines.push(pad(` ${dim("/tmp")}  ${dim("$0.004 (sub)")}  ${dim("8.1%/272k (auto)")}`, `${fg(244, "claude-opus-5")} ${dim("• high")} `));
	lines.push(` ${fg(141, "◆ rainbow")} ${dim("panels · diagonal/scroll · 6fx · 24fps")}`);

	return lines.slice(0, height);
}

/** Visible width of a styled string, ignoring SGR sequences. */
function visible(s: string): number {
	return [...s.replace(/\u001b\[[0-9;]*m/g, "")].length;
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
	/** Advance the sample session over time instead of holding one screen. */
	script?: boolean;
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
	const fixed = opts.content;

	// Warm the engine so time-based effects are past their first frame.
	const out: string[][] = [];
	const warm = Math.max(0, Math.round((opts.t0 ?? 0) * fps));
	for (let i = 0; i < warm + frames; i++) {
		// Rebuild the screen each frame so the sample session can advance:
		// a static screenshot hides the fact that panels appear and disappear
		// as pi works, which is the whole point of scoping to them.
		const content = fixed ?? sampleScreen(width, height, opts.script ? i / fps : undefined);
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
	out.push(`scopes (${SCOPES.length}):`);
	for (const s of SCOPES) out.push(`  ${s.id.padEnd(18)} ${s.blurb}`);
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

	// --scope lets the screenshot tooling render the same bundle at every scope.
	const script = args.includes("--script");
	const scopeIdx = args.indexOf("--scope");
	if (scopeIdx >= 0 && args[scopeIdx + 1]) {
		settings.scope = args[scopeIdx + 1] as RainbowSettings["scope"];
	}

	const width = flag("width", Math.min(120, process.stdout.columns || 100));
	const height = flag("height", Math.min(40, (process.stdout.rows || 32) - 1));
	const frames = flag("frames", 1);
	const fps = flag("fps", 24);
	const t0 = flag("t0", 0);

	const list = renderFrames(settings, { width, height, frames, fps, t0, script });

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
