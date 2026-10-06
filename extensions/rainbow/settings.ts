import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { GRADIENT_MODES, type GradientMode, MOTION_MODES, type MotionMode } from "./field.js";
import { type RainbowScope, SCOPES } from "./layout.js";
import { fxIds, getFx } from "./fx.js";
import { DEFAULT_PRESET, hasPreset } from "./presets.js";

/** How the frame post-process behaves outside fullscreen (regular scrollback mode). */
export type RegularModePolicy = "off" | "viewport" | "full";

export type RainbowSettings = {
	enabled: boolean;

	/* palette */
	preset: string;
	/** Crossfade duration when switching presets, seconds. */
	presetFade: number;
	/** Auto-advance to a new preset every N seconds. 0 = never. */
	presetCycle: number;

	/* gradient field */
	/** How much of the screen the rainbow is allowed to touch. */
	scope: RainbowScope;
	mode: GradientMode;
	motion: MotionMode;
	/** Palette cycles per second. */
	speed: number;
	/** Palette repeats across the screen. */
	turns: number;
	/** Static rotation of the gradient, in turns (0..1). */
	angle: number;

	/* how colour is applied */
	/** 0 = keep original colours, 1 = fully replaced by the palette. */
	blend: number;
	/** Extra chroma on the palette, 0..2. */
	vibrance: number;
	/** Lightness bias, -0.5..0.5. */
	brightness: number;
	/** Recolour text foregrounds. */
	colorText: boolean;
	/** Paint the background of empty cells. */
	colorBackground: boolean;
	/** Leave dim/secondary chrome alone so the UI stays legible. */
	preserveDim: boolean;
	/** Pad rows to the full terminal width so background effects reach the edges. */
	fullBleed: boolean;

	/* effects */
	/** Effect id → intensity (0..1). Missing or 0 means off. */
	fx: Record<string, number>;
	/** Master multiplier over every effect intensity. */
	chaos: number;

	/* animation */
	/** Target frames per second for the animation pump. */
	fps: number;
	/** Keep animating when the agent is idle. */
	alwaysAnimate: boolean;
	/** Drop to this fps after `idleAfter` seconds without activity. */
	idleFps: number;
	idleAfter: number;
	/** Animate even when running inside tmux (can be heavy). */
	animateInTmux: boolean;
	/** Speed up and intensify while the agent is working. */
	reactive: boolean;
	/** Calm everything down while a dialog/overlay is open. */
	calmOnOverlay: boolean;
	/** Honour prefers-reduced-motion style restraint. */
	reducedMotion: boolean;
	/** Skip effects when a frame takes longer than this (ms). 0 disables the guard. */
	frameBudgetMs: number;

	/* scope */
	regularMode: RegularModePolicy;
	/** Colour the prompt editor text. */
	colorInput: boolean;
	/** Show a small status line with the current preset/fx. */
	showStatus: boolean;
	/** Show the animated splash on startup. */
	splashOnStart: boolean;
};

export const DEFAULT_FX: Record<string, number> = {
	starfield: 0.45,
	shine: 0.4,
	vignette: 0.35,
	heat: 0.5,
	bloom: 0.3,
};

export const DEFAULT_SETTINGS: RainbowSettings = {
	enabled: true,

	preset: DEFAULT_PRESET,
	presetFade: 0.8,
	presetCycle: 0,

	scope: "panels",
	mode: "diagonal",
	motion: "scroll",
	speed: 0.12,
	turns: 2,
	angle: 0,

	blend: 0.85,
	vibrance: 1,
	brightness: 0,
	colorText: true,
	colorBackground: true,
	preserveDim: true,
	fullBleed: true,

	fx: { ...DEFAULT_FX },
	chaos: 1,

	fps: 24,
	alwaysAnimate: true,
	idleFps: 10,
	idleAfter: 25,
	animateInTmux: true,
	reactive: true,
	calmOnOverlay: true,
	reducedMotion: false,
	frameBudgetMs: 28,

	regularMode: "off",
	colorInput: true,
	showStatus: false,
	splashOnStart: false,
};

/* ------------------------------------------------------------------ */

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

const GRADIENT_SET = new Set<GradientMode>([
	"diagonal",
	"horizontal",
	"vertical",
	"radial",
	"conic",
	"spiral",
	"ripple",
	"plasma",
	"noise",
	"marble",
	"moire",
	"checker",
	"kaleido",
	"voronoi",
	"tunnel",
	"lissajous",
]);

const MOTION_SET = new Set<MotionMode>(["scroll", "pulse", "wave", "orbit", "jitter", "breathe", "drift", "none"]);
const SCOPE_SET = new Set<RainbowScope>(SCOPES.map((s) => s.id));

function normalizeFx(value: unknown): Record<string, number> {
	const out: Record<string, number> = {};
	if (!value || typeof value !== "object") return { ...DEFAULT_FX };
	const known = new Set(fxIds());
	for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
		if (!known.has(id)) continue;
		const n = typeof raw === "boolean" ? (raw ? (getFx(id)?.defaultIntensity ?? 0.5) : 0) : num(raw, 0);
		if (n > 0) out[id] = clamp(n, 0, 1);
	}
	return out;
}

export function normalizeSettings(value: Partial<RainbowSettings> | undefined): RainbowSettings {
	const d = DEFAULT_SETTINGS;
	const preset = typeof value?.preset === "string" && value.preset.trim() ? value.preset.trim() : d.preset;
	return {
		enabled: bool(value?.enabled, d.enabled),

		preset: preset.includes("#") || hasPreset(preset) ? preset : d.preset,
		presetFade: clamp(num(value?.presetFade, d.presetFade), 0, 5),
		presetCycle: clamp(num(value?.presetCycle, d.presetCycle), 0, 3600),

		scope: SCOPE_SET.has(value?.scope as RainbowScope) ? (value!.scope as RainbowScope) : d.scope,
		mode: GRADIENT_SET.has(value?.mode as GradientMode) ? (value!.mode as GradientMode) : d.mode,
		motion: MOTION_SET.has(value?.motion as MotionMode) ? (value!.motion as MotionMode) : d.motion,
		speed: clamp(num(value?.speed, d.speed), 0, 3),
		turns: clamp(num(value?.turns, d.turns), 0.1, 16),
		angle: clamp(num(value?.angle, d.angle), 0, 1),

		blend: clamp(num(value?.blend, d.blend), 0, 1),
		vibrance: clamp(num(value?.vibrance, d.vibrance), 0, 2),
		brightness: clamp(num(value?.brightness, d.brightness), -0.5, 0.5),
		colorText: bool(value?.colorText, d.colorText),
		colorBackground: bool(value?.colorBackground, d.colorBackground),
		preserveDim: bool(value?.preserveDim, d.preserveDim),
		fullBleed: bool(value?.fullBleed, d.fullBleed),

		fx: normalizeFx(value?.fx),
		chaos: clamp(num(value?.chaos, d.chaos), 0, 2),

		fps: clamp(Math.round(num(value?.fps, d.fps)), 1, 60),
		alwaysAnimate: bool(value?.alwaysAnimate, d.alwaysAnimate),
		idleFps: clamp(Math.round(num(value?.idleFps, d.idleFps)), 0, 60),
		idleAfter: clamp(num(value?.idleAfter, d.idleAfter), 1, 600),
		animateInTmux: bool(value?.animateInTmux, d.animateInTmux),
		reactive: bool(value?.reactive, d.reactive),
		calmOnOverlay: bool(value?.calmOnOverlay, d.calmOnOverlay),
		reducedMotion: bool(value?.reducedMotion, d.reducedMotion),
		frameBudgetMs: clamp(num(value?.frameBudgetMs, d.frameBudgetMs), 0, 500),

		regularMode:
			value?.regularMode === "viewport" || value?.regularMode === "full" || value?.regularMode === "off"
				? value.regularMode
				: d.regularMode,
		colorInput: bool(value?.colorInput, d.colorInput),
		showStatus: bool(value?.showStatus, d.showStatus),
		splashOnStart: bool(value?.splashOnStart, d.splashOnStart),
	};
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const PI_AGENT_DIR = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
export const SETTINGS_PATH = join(PI_AGENT_DIR, "state", "pi-plugin-rainbow.json");

export async function loadSettings(): Promise<RainbowSettings> {
	try {
		const raw = await readFile(SETTINGS_PATH, "utf8");
		return normalizeSettings(JSON.parse(raw) as Partial<RainbowSettings>);
	} catch {
		return { ...DEFAULT_SETTINGS, fx: { ...DEFAULT_FX } };
	}
}

let writeChain: Promise<void> = Promise.resolve();

export function saveSettings(value: RainbowSettings): Promise<void> {
	const next = normalizeSettings(value);
	writeChain = writeChain
		.catch(() => undefined)
		.then(async () => {
			await mkdir(dirname(SETTINGS_PATH), { recursive: true });
			await writeFile(SETTINGS_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
		});
	return writeChain;
}

type Listener = (value: RainbowSettings) => void;

export class RainbowSettingsStore {
	private value: RainbowSettings;
	private listeners = new Set<Listener>();

	constructor(initial: RainbowSettings) {
		this.value = normalizeSettings(initial);
	}

	get(): RainbowSettings {
		return this.value;
	}

	set(next: RainbowSettings): void {
		this.value = normalizeSettings(next);
		for (const l of this.listeners) l(this.value);
	}

	/** Shallow patch + notify. Returns the normalised result. */
	patch(partial: Partial<RainbowSettings>): RainbowSettings {
		this.set({ ...this.value, ...partial });
		return this.value;
	}

	setFx(id: string, intensity: number): RainbowSettings {
		const fx = { ...this.value.fx };
		if (intensity <= 0) delete fx[id];
		else fx[id] = Math.min(1, intensity);
		return this.patch({ fx });
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
}

/* ------------------------------------------------------------------ *
 * Named bundles — one command flips a whole look
 * ------------------------------------------------------------------ */

export type Bundle = {
	id: string;
	name: string;
	blurb: string;
	settings: Partial<RainbowSettings>;
};

export const BUNDLES: Bundle[] = [
	{
		id: "zen",
		name: "Zen",
		blurb: "barely there — a slow tint and nothing else",
		settings: {
			preset: "nord",
			mode: "diagonal",
			motion: "breathe",
			speed: 0.04,
			turns: 1,
			blend: 0.72,
			vibrance: 1.3,
			chaos: 0.6,
			colorBackground: true,
			fx: { vignette: 0.25 },
			fps: 12,
		},
	},
	{
		id: "default",
		name: "Default",
		blurb: "the shipped look",
		settings: {
			...DEFAULT_SETTINGS,
			fx: { ...DEFAULT_FX },
		},
	},
	{
		id: "crt",
		name: "CRT",
		blurb: "phosphor glow, scanlines, a bit of grain",
		settings: {
			preset: "phosphor",
			mode: "vertical",
			motion: "scroll",
			speed: 0.05,
			turns: 1,
			blend: 0.95,
			colorBackground: true,
			fx: { scanlines: 0.55, vignette: 0.6, noisegrain: 0.35, bloom: 0.45, interlace: 0.3, neon: 0.4 },
			chaos: 1,
		},
	},
	{
		id: "synthwave",
		name: "Synthwave",
		blurb: "grid floor, neon text, sunset palette",
		settings: {
			preset: "synthwave",
			mode: "vertical",
			motion: "scroll",
			speed: 0.08,
			turns: 1.5,
			blend: 0.9,
			colorBackground: true,
			fx: { gridfloor: 0.8, neon: 0.6, bloom: 0.5, vignette: 0.5, starfield: 0.4, shine: 0.3 },
			chaos: 1,
		},
	},
	{
		id: "matrix",
		name: "Matrix",
		blurb: "digital rain, green on green",
		settings: {
			preset: "matrix",
			mode: "vertical",
			motion: "scroll",
			speed: 0.06,
			turns: 1,
			blend: 0.95,
			colorBackground: true,
			fx: { matrix: 0.8, scanlines: 0.3, bloom: 0.4, vignette: 0.45, heat: 0.5 },
			chaos: 1,
		},
	},
	{
		id: "inferno",
		name: "Inferno",
		blurb: "the terminal is on fire",
		settings: {
			preset: "lava",
			mode: "noise",
			motion: "drift",
			speed: 0.1,
			turns: 2,
			blend: 0.9,
			colorBackground: true,
			fx: { fire: 0.8, heat: 0.7, bloom: 0.5, vignette: 0.55, noisegrain: 0.25 },
			chaos: 1,
		},
	},
	{
		id: "deepspace",
		name: "Deep Space",
		blurb: "stars, comets, slow nebula drift",
		settings: {
			preset: "galaxy",
			mode: "noise",
			motion: "drift",
			speed: 0.03,
			turns: 1.2,
			blend: 0.85,
			colorBackground: true,
			fx: { starfield: 0.8, comet: 0.7, plasmafield: 0.3, bloom: 0.4, vignette: 0.6, aurora: 0.3 },
			chaos: 1,
		},
	},
	{
		id: "storm",
		name: "Storm",
		blurb: "rain, lightning, and a cold palette",
		settings: {
			preset: "storm",
			mode: "vertical",
			motion: "scroll",
			speed: 0.09,
			turns: 1.5,
			blend: 0.85,
			colorBackground: true,
			fx: { rain: 0.7, lightning: 0.5, vignette: 0.5, noisegrain: 0.2, bloom: 0.3 },
			chaos: 1,
		},
	},
	{
		id: "winter",
		name: "Winter",
		blurb: "snow drifting past a cold blue gradient",
		settings: {
			preset: "ice",
			mode: "diagonal",
			motion: "drift",
			speed: 0.05,
			turns: 1.5,
			blend: 0.8,
			colorBackground: true,
			fx: { snow: 0.7, vignette: 0.4, bloom: 0.3, shine: 0.25 },
			chaos: 1,
		},
	},
	{
		id: "hanami",
		name: "Hanami",
		blurb: "petals, soft pinks, gentle light",
		settings: {
			preset: "sakura",
			mode: "diagonal",
			motion: "drift",
			speed: 0.04,
			turns: 1.2,
			blend: 0.75,
			vibrance: 1.25,
			brightness: -0.22,
			colorBackground: true,
			fx: { sakura: 0.85, bloom: 0.3, vignette: 0.5, shine: 0.15 },
			chaos: 1,
		},
	},
	{
		id: "aquarium",
		name: "Aquarium",
		blurb: "bubbles rising through deep water",
		settings: {
			preset: "deep-sea",
			mode: "radial",
			motion: "breathe",
			speed: 0.05,
			turns: 2,
			blend: 0.85,
			colorBackground: true,
			fx: { bubbles: 0.7, aurora: 0.4, vignette: 0.55, bloom: 0.3, wobble: 0.3 },
			chaos: 1,
		},
	},
	{
		id: "party",
		name: "Party",
		blurb: "everything, all at once",
		settings: {
			preset: "neon",
			mode: "plasma",
			motion: "drift",
			speed: 0.3,
			turns: 3,
			blend: 1,
			colorBackground: true,
			fx: {
				confetti: 0.6,
				starfield: 0.5,
				fireflies: 0.5,
				shine: 0.6,
				bloom: 0.6,
				neon: 0.6,
				ripples: 0.8,
				waveform: 0.7,
				wobble: 0.4,
				breathing: 0.4,
			},
			chaos: 1.3,
		},
	},
	{
		id: "chaos",
		name: "Chaos",
		blurb: "no survivors",
		settings: {
			preset: "acid",
			mode: "voronoi",
			motion: "jitter",
			speed: 0.6,
			turns: 4,
			blend: 1,
			colorBackground: true,
			fx: {
				glitch: 0.8,
				aberration: 0.7,
				strobe: 0.35,
				confetti: 0.7,
				lightning: 0.6,
				wobble: 0.7,
				bloom: 0.7,
				noisegrain: 0.5,
				interlace: 0.5,
				matrix: 0.5,
			},
			chaos: 1.6,
		},
	},
];

export function getBundle(id: string): Bundle | undefined {
	const key = id.trim().toLowerCase();
	return BUNDLES.find((b) => b.id === key || b.name.toLowerCase() === key);
}
