/**
 * Palette library.
 *
 * Each preset is a list of colour stops. The ramp builder interpolates between
 * them in OKLab and (for cyclic ramps) wraps the last stop back to the first, so
 * scrolling gradients have no seam.
 *
 * `cyclic: false` is for palettes that read as a one-way sweep (sunsets, thermal
 * cameras, duotones); those ping-pong instead of wrapping.
 */

import { buildRamp, parseHex, type Ramp, type RGB } from "./color.js";

export type PresetGroup = "rainbow" | "pride" | "theme" | "mood" | "retro" | "nature" | "wild";

export type Preset = {
	id: string;
	name: string;
	group: PresetGroup;
	blurb: string;
	colors: string[];
	cyclic?: boolean;
	/** Extra names accepted by `/rainbow-preset`. */
	aliases?: string[];
};

export const PRESETS: Preset[] = [
	/* ---------------- rainbows ---------------- */
	{
		id: "classic",
		name: "Classic Rainbow",
		group: "rainbow",
		blurb: "ROYGBIV, the one your terminal was born for",
		colors: ["#ff0000", "#ff8800", "#ffee00", "#33dd33", "#0099ff", "#4433ff", "#aa33ff"],
		aliases: ["rainbow", "roygbiv"],
	},
	{
		id: "spectrum",
		name: "Pure Spectrum",
		group: "rainbow",
		blurb: "evenly spaced hue wheel, maximum chroma",
		colors: [
			"#ff0040",
			"#ff8000",
			"#ffd400",
			"#80ff00",
			"#00ff55",
			"#00ffcc",
			"#00aaff",
			"#2a40ff",
			"#8800ff",
			"#ff00cc",
		],
		aliases: ["hue", "wheel"],
	},
	{
		id: "pastel",
		name: "Pastel Dream",
		group: "rainbow",
		blurb: "soft and chalky, easy on tired eyes",
		colors: ["#ffb3ba", "#ffdfba", "#ffffba", "#baffc9", "#bae1ff", "#d7baff", "#ffbaf2"],
		aliases: ["soft"],
	},
	{
		id: "neon",
		name: "Neon Overdrive",
		group: "rainbow",
		blurb: "screaming saturation, do not stare directly",
		colors: ["#ff0266", "#ff6d00", "#ffea00", "#00e676", "#00e5ff", "#2979ff", "#d500f9"],
		aliases: ["bright"],
	},
	{
		id: "double-rainbow",
		name: "Double Rainbow",
		group: "rainbow",
		blurb: "all the way across the sky (12 stops, twice the bands)",
		colors: [
			"#ff0000",
			"#ff7f00",
			"#ffff00",
			"#00ff00",
			"#0000ff",
			"#4b0082",
			"#9400d3",
			"#ff0000",
			"#ff7f00",
			"#ffff00",
			"#00ff00",
			"#0000ff",
		],
		aliases: ["double"],
	},
	{
		id: "prism",
		name: "Prism Split",
		group: "rainbow",
		blurb: "white light through glass — tight bands, dark gaps",
		colors: ["#120024", "#ff2d55", "#ffcc00", "#34ffb0", "#2d9bff", "#7b2dff", "#120024"],
	},

	/* ---------------- pride ---------------- */
	{
		id: "pride",
		name: "Pride",
		group: "pride",
		blurb: "the six-stripe flag",
		colors: ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"],
		aliases: ["gay"],
	},
	{
		id: "progress",
		name: "Progress Pride",
		group: "pride",
		blurb: "six stripes plus the chevron colours",
		colors: [
			"#e40303",
			"#ff8c00",
			"#ffed00",
			"#008026",
			"#004dff",
			"#750787",
			"#000000",
			"#613915",
			"#74d7ee",
			"#ffafc8",
			"#ffffff",
		],
	},
	{
		id: "trans",
		name: "Trans Pride",
		group: "pride",
		blurb: "blue / pink / white",
		colors: ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"],
	},
	{
		id: "bi",
		name: "Bi Pride",
		group: "pride",
		blurb: "magenta / lavender / royal blue",
		colors: ["#d60270", "#9b4f96", "#0038a8"],
	},
	{
		id: "lesbian",
		name: "Lesbian Pride",
		group: "pride",
		blurb: "orange through white to pink",
		colors: ["#d52d00", "#ef7627", "#ff9a56", "#ffffff", "#d162a4", "#b55690", "#a30262"],
	},
	{
		id: "nonbinary",
		name: "Nonbinary Pride",
		group: "pride",
		blurb: "yellow / white / purple / black",
		colors: ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"],
		aliases: ["enby"],
	},
	{
		id: "ace",
		name: "Asexual Pride",
		group: "pride",
		blurb: "black / grey / white / purple",
		colors: ["#000000", "#a3a3a3", "#ffffff", "#800080"],
	},
	{
		id: "pan",
		name: "Pan Pride",
		group: "pride",
		blurb: "pink / yellow / cyan",
		colors: ["#ff218c", "#ffd800", "#21b1ff"],
	},

	/* ---------------- editor themes ---------------- */
	{
		id: "catppuccin",
		name: "Catppuccin Mocha",
		group: "theme",
		blurb: "the internet's comfort theme",
		colors: ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89b4fa", "#cba6f7"],
		aliases: ["cat", "mocha"],
	},
	{
		id: "catppuccin-latte",
		name: "Catppuccin Latte",
		group: "theme",
		blurb: "the light one, for daytime people",
		colors: ["#d20f39", "#fe640b", "#df8e1d", "#40a02b", "#179299", "#1e66f5", "#8839ef"],
		aliases: ["latte"],
	},
	{
		id: "dracula",
		name: "Dracula",
		group: "theme",
		blurb: "purple vampire classic",
		colors: ["#ff5555", "#ffb86c", "#f1fa8c", "#50fa7b", "#8be9fd", "#bd93f9", "#ff79c6"],
	},
	{
		id: "gruvbox",
		name: "Gruvbox Dark",
		group: "theme",
		blurb: "retro-warm, low contrast",
		colors: ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"],
		aliases: ["gruv"],
	},
	{
		id: "gruvbox-light",
		name: "Gruvbox Light",
		group: "theme",
		blurb: "the paper version",
		colors: ["#9d0006", "#af3a03", "#b57614", "#79740e", "#427b58", "#076678", "#8f3f71"],
	},
	{
		id: "nord",
		name: "Nord",
		group: "theme",
		blurb: "arctic, bluish, calm",
		colors: ["#bf616a", "#d08770", "#ebcb8b", "#a3be8c", "#88c0d0", "#81a1c1", "#b48ead"],
	},
	{
		id: "tokyo-night",
		name: "Tokyo Night",
		group: "theme",
		blurb: "neon reflections on wet asphalt",
		colors: ["#f7768e", "#ff9e64", "#e0af68", "#9ece6a", "#73daca", "#7aa2f7", "#bb9af7"],
		aliases: ["tokyo"],
	},
	{
		id: "rose-pine",
		name: "Rosé Pine",
		group: "theme",
		blurb: "soho vibes for the terminal",
		colors: ["#eb6f92", "#f6c177", "#ebbcba", "#31748f", "#9ccfd8", "#c4a7e7"],
		aliases: ["rose"],
	},
	{
		id: "kanagawa",
		name: "Kanagawa",
		group: "theme",
		blurb: "Hokusai's wave, in hex",
		colors: ["#c34043", "#ffa066", "#dca561", "#98bb6c", "#7aa89f", "#7e9cd8", "#957fb8"],
	},
	{
		id: "everforest",
		name: "Everforest",
		group: "theme",
		blurb: "mossy and soft",
		colors: ["#e67e80", "#e69875", "#dbbc7f", "#a7c080", "#83c092", "#7fbbb3", "#d699b6"],
	},
	{
		id: "solarized",
		name: "Solarized Dark",
		group: "theme",
		blurb: "the one with the scientific whitepaper",
		colors: ["#dc322f", "#cb4b16", "#b58900", "#859900", "#2aa198", "#268bd2", "#d33682"],
	},
	{
		id: "monokai",
		name: "Monokai",
		group: "theme",
		blurb: "sublime nostalgia",
		colors: ["#f92672", "#fd971f", "#e6db74", "#a6e22e", "#66d9ef", "#ae81ff"],
	},
	{
		id: "one-dark",
		name: "One Dark",
		group: "theme",
		blurb: "atom's parting gift",
		colors: ["#e06c75", "#d19a66", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd"],
	},
	{
		id: "ayu",
		name: "Ayu Mirage",
		group: "theme",
		blurb: "muted orange and teal",
		colors: ["#f28779", "#ffad66", "#ffd173", "#d5ff80", "#95e6cb", "#5ccfe6", "#dfbfff"],
	},
	{
		id: "night-owl",
		name: "Night Owl",
		group: "theme",
		blurb: "for people who ship at 3am",
		colors: ["#ef5350", "#f78c6c", "#ffeb95", "#addb67", "#7fdbca", "#82aaff", "#c792ea"],
	},
	{
		id: "github-dark",
		name: "GitHub Dark",
		group: "theme",
		blurb: "corporate but tasteful",
		colors: ["#ff7b72", "#ffa657", "#e3b341", "#7ee787", "#39c5cf", "#79c0ff", "#d2a8ff"],
	},
	{
		id: "zenburn",
		name: "Zenburn",
		group: "theme",
		blurb: "the original low-contrast theme",
		colors: ["#cc9393", "#dfaf8f", "#f0dfaf", "#7f9f7f", "#93e0e3", "#8cd0d3", "#dc8cc3"],
	},

	/* ---------------- retro / CRT ---------------- */
	{
		id: "synthwave",
		name: "Synthwave '84",
		group: "retro",
		blurb: "chrome lettering over a purple grid",
		colors: ["#ff7edb", "#fe4450", "#f97e72", "#ffcc00", "#72f1b8", "#36f9f6", "#b893ce"],
		aliases: ["synth", "84"],
	},
	{
		id: "outrun",
		name: "Outrun",
		group: "retro",
		blurb: "sunset over an infinite highway",
		colors: ["#2b1055", "#7597de", "#ff1b6b", "#ff8a00", "#ffd200", "#ff1b6b", "#2b1055"],
		cyclic: false,
	},
	{
		id: "vaporwave",
		name: "Vaporwave",
		group: "retro",
		blurb: "ｍａｃｉｎｔｏｓｈ　ｐｌｕｓ",
		colors: ["#ff71ce", "#01cdfe", "#05ffa1", "#b967ff", "#fffb96"],
		aliases: ["vapor", "aesthetic"],
	},
	{
		id: "miami",
		name: "Miami Vice",
		group: "retro",
		blurb: "pastel pink, teal, linen suits",
		colors: ["#ff6ec7", "#00e5ee", "#fdfd96", "#ff9966", "#8e6bff"],
	},
	{
		id: "phosphor",
		name: "Phosphor Green",
		group: "retro",
		blurb: "VT220 burn-in, no apologies",
		colors: ["#001100", "#00ff41", "#9dff9d", "#00ff41", "#001100"],
		cyclic: false,
		aliases: ["vt220", "green"],
	},
	{
		id: "amber",
		name: "Amber CRT",
		group: "retro",
		blurb: "IBM 5151, warm and radioactive",
		colors: ["#150700", "#ffb000", "#ffd28a", "#ffb000", "#150700"],
		cyclic: false,
		aliases: ["5151"],
	},
	{
		id: "matrix",
		name: "Matrix",
		group: "retro",
		blurb: "there is no spoon",
		colors: ["#001a00", "#003b00", "#008f11", "#00ff41", "#d4ffd4", "#00ff41", "#008f11"],
		cyclic: false,
	},
	{
		id: "tron",
		name: "Tron",
		group: "retro",
		blurb: "cyan light cycles on black",
		colors: ["#000d13", "#0a4d68", "#00c3ff", "#aefeff", "#00c3ff", "#0a4d68"],
		cyclic: false,
	},
	{
		id: "commodore",
		name: "Commodore 64",
		group: "retro",
		blurb: "the 16-colour PETSCII palette",
		colors: ["#6c5eb5", "#8f8f8f", "#b6686a", "#71a05b", "#6c5eb5", "#cbdc7b", "#9f4e44"],
	},
	{
		id: "gameboy",
		name: "Game Boy",
		group: "retro",
		blurb: "four shades of swamp",
		colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
		cyclic: false,
		aliases: ["dmg"],
	},
	{
		id: "teletext",
		name: "Teletext",
		group: "retro",
		blurb: "Ceefax page 101, pure primaries",
		colors: ["#ff0000", "#00ff00", "#ffff00", "#0000ff", "#ff00ff", "#00ffff", "#ffffff"],
	},

	/* ---------------- moods ---------------- */
	{
		id: "sunset",
		name: "Sunset",
		group: "mood",
		blurb: "deep blue to burning orange",
		colors: ["#1a1a3e", "#2d1b69", "#8e2de2", "#e94057", "#f27121", "#ffd166"],
		cyclic: false,
	},
	{
		id: "sunrise",
		name: "Sunrise",
		group: "mood",
		blurb: "the good half of the same gradient",
		colors: ["#0b1a3a", "#3a3897", "#f06966", "#ffb88c", "#ffe29f"],
		cyclic: false,
	},
	{
		id: "ocean",
		name: "Ocean",
		group: "mood",
		blurb: "shallow turquoise down to the trench",
		colors: ["#caf0f8", "#90e0ef", "#00b4d8", "#0077b6", "#023e8a", "#03045e"],
		cyclic: false,
	},
	{
		id: "deep-sea",
		name: "Deep Sea",
		group: "mood",
		blurb: "bioluminescence at 3000m",
		colors: ["#01010a", "#031d44", "#04395e", "#0a9396", "#94d2bd", "#0a9396", "#031d44"],
		cyclic: false,
	},
	{
		id: "lava",
		name: "Lava",
		group: "mood",
		blurb: "black rock, white-hot cracks",
		colors: ["#100000", "#5c0000", "#c1121f", "#ff6d00", "#ffd60a", "#fff3b0"],
		cyclic: false,
	},
	{
		id: "ice",
		name: "Ice",
		group: "mood",
		blurb: "glacier blue and frost",
		colors: ["#e0fbfc", "#98c1d9", "#3d5a80", "#293241", "#3d5a80", "#98c1d9"],
		cyclic: false,
	},
	{
		id: "toxic",
		name: "Toxic",
		group: "mood",
		blurb: "do not drink the green stuff",
		colors: ["#0b0f00", "#1b3d00", "#5bd600", "#aaff00", "#e8ff5c", "#aaff00", "#5bd600"],
		cyclic: false,
	},
	{
		id: "blood",
		name: "Blood",
		group: "mood",
		blurb: "for when the tests fail",
		colors: ["#0a0000", "#3d0000", "#8b0000", "#d10000", "#ff3b3b", "#ffb3b3"],
		cyclic: false,
	},
	{
		id: "candy",
		name: "Candy Shop",
		group: "mood",
		blurb: "sugar rush",
		colors: ["#ff5f9e", "#ffa5cb", "#fff3b0", "#b5ead7", "#a0c4ff", "#cdb4db"],
	},
	{
		id: "cotton",
		name: "Cotton Candy",
		group: "mood",
		blurb: "two flavours, swirled",
		colors: ["#ffafcc", "#bde0fe", "#ffc8dd", "#a2d2ff"],
	},
	{
		id: "unicorn",
		name: "Unicorn",
		group: "mood",
		blurb: "iridescent and unapologetic",
		colors: ["#ffb3f0", "#c1a7ff", "#a7d8ff", "#a7ffd8", "#fff7a7", "#ffc2a7"],
	},
	{
		id: "galaxy",
		name: "Galaxy",
		group: "mood",
		blurb: "deep space with hot pink nebulae",
		colors: ["#03001e", "#3c096c", "#7b2cbf", "#e0aaff", "#ff6ec7", "#7b2cbf", "#3c096c"],
		cyclic: false,
	},
	{
		id: "nebula",
		name: "Nebula",
		group: "mood",
		blurb: "Hubble false-colour",
		colors: ["#0d0221", "#0f4c81", "#26c485", "#f9c22e", "#f15946", "#5d2e8c"],
	},
	{
		id: "aurora",
		name: "Aurora",
		group: "mood",
		blurb: "northern lights over a dark sky",
		colors: ["#020a14", "#073b4c", "#06d6a0", "#8ce99a", "#b197fc", "#073b4c"],
		cyclic: false,
	},
	{
		id: "holographic",
		name: "Holographic",
		group: "mood",
		blurb: "trading-card foil",
		colors: ["#ffffff", "#ffd1f0", "#c4f0ff", "#d8ffd1", "#fff6c4", "#ffd1f0"],
	},
	{
		id: "oil-slick",
		name: "Oil Slick",
		group: "mood",
		blurb: "petrol rainbow on a wet road",
		colors: ["#101014", "#1b3b6f", "#065a60", "#6a4c93", "#b5179e", "#1b3b6f"],
	},
	{
		id: "chrome",
		name: "Liquid Chrome",
		group: "mood",
		blurb: "brushed metal with a blue tint",
		colors: ["#1c1f26", "#6b7280", "#d6dde6", "#ffffff", "#9aa6b2", "#3f4754"],
	},
	{
		id: "gold",
		name: "Gold Leaf",
		group: "mood",
		blurb: "expensive looking nonsense",
		colors: ["#2b1700", "#8a5a00", "#d4a017", "#ffd700", "#fff2b2", "#d4a017"],
	},
	{
		id: "thermal",
		name: "Thermal Camera",
		group: "mood",
		blurb: "FLIR ironbow",
		colors: ["#000033", "#4b0082", "#c2185b", "#ff6f00", "#ffd600", "#ffffff"],
		cyclic: false,
		aliases: ["flir", "ironbow"],
	},
	{
		id: "ultraviolet",
		name: "Ultraviolet",
		group: "mood",
		blurb: "blacklight poster energy",
		colors: ["#0a0014", "#3d0066", "#7b00ff", "#c77dff", "#e0aaff", "#7b00ff"],
		cyclic: false,
	},
	{
		id: "mono",
		name: "Monochrome",
		group: "mood",
		blurb: "pure luminance, no hue at all",
		colors: ["#000000", "#555555", "#aaaaaa", "#ffffff", "#aaaaaa", "#555555"],
		cyclic: false,
		aliases: ["grey", "gray", "bw"],
	},
	{
		id: "sepia",
		name: "Sepia",
		group: "mood",
		blurb: "developed in 1890",
		colors: ["#1b1109", "#4a3421", "#8a6a43", "#c7a17a", "#f2e2cb", "#c7a17a"],
		cyclic: false,
	},
	{
		id: "duotone",
		name: "Cyan / Magenta",
		group: "mood",
		blurb: "two-colour print job",
		colors: ["#00e5ff", "#1a1a2e", "#ff00a0", "#1a1a2e"],
	},
	{
		id: "fire-and-ice",
		name: "Fire and Ice",
		group: "mood",
		blurb: "two opposed gradients meeting in the middle",
		colors: ["#00d4ff", "#8ecae6", "#ffffff", "#ffb703", "#fb5607", "#ffffff", "#8ecae6"],
	},

	/* ---------------- nature ---------------- */
	{
		id: "forest",
		name: "Forest",
		group: "nature",
		blurb: "canopy light",
		colors: ["#071a07", "#1b4332", "#2d6a4f", "#52b788", "#b7e4c7", "#52b788", "#2d6a4f"],
		cyclic: false,
	},
	{
		id: "autumn",
		name: "Autumn",
		group: "nature",
		blurb: "leaves on the way down",
		colors: ["#582f0e", "#7f4f24", "#bb9457", "#d4a373", "#e76f51", "#a53f2b"],
	},
	{
		id: "sakura",
		name: "Sakura",
		group: "nature",
		blurb: "petals against a grey sky",
		colors: ["#3d2b35", "#8d6b7a", "#f4c2c2", "#ffe4e9", "#ffffff", "#f4c2c2"],
		cyclic: false,
	},
	{
		id: "desert",
		name: "Desert",
		group: "nature",
		blurb: "sandstone and heat haze",
		colors: ["#3e2c23", "#8b5e34", "#dda15e", "#fefae0", "#bc6c25", "#8b5e34"],
	},
	{
		id: "mint",
		name: "Mint",
		group: "nature",
		blurb: "cool and clean",
		colors: ["#0b3d2e", "#1b7a5a", "#4ecca3", "#a8e6cf", "#e8fff7", "#a8e6cf"],
		cyclic: false,
	},
	{
		id: "peach",
		name: "Peach",
		group: "nature",
		blurb: "warm fuzz",
		colors: ["#4a2222", "#a35c4a", "#ff9472", "#ffcdb2", "#fff0e6", "#ffcdb2"],
		cyclic: false,
	},
	{
		id: "storm",
		name: "Storm",
		group: "nature",
		blurb: "slate clouds with a lightning edge",
		colors: ["#0d1117", "#2a3240", "#55606e", "#9aa7b4", "#f0f6ff", "#55606e"],
		cyclic: false,
	},

	/* ---------------- wild ---------------- */
	{
		id: "hazard",
		name: "Hazard Tape",
		group: "wild",
		blurb: "hard black/yellow stripes, no blending",
		colors: ["#ffd400", "#ffd400", "#121212", "#121212"],
	},
	{
		id: "traffic",
		name: "Traffic Light",
		group: "wild",
		blurb: "stop, caution, go",
		colors: ["#ff1f1f", "#ffc300", "#1fdd4f"],
	},
	{
		id: "glitch",
		name: "Glitch",
		group: "wild",
		blurb: "RGB channel separation in palette form",
		colors: ["#ff0000", "#000000", "#00ff00", "#000000", "#0000ff", "#000000"],
	},
	{
		id: "acid",
		name: "Acid",
		group: "wild",
		blurb: "clashing on purpose",
		colors: ["#ff00ff", "#ccff00", "#00ffff", "#ff6600", "#9900ff"],
	},
	{
		id: "blacklight",
		name: "Blacklight Bowling",
		group: "wild",
		blurb: "1998 birthday party",
		colors: ["#120024", "#ff00e6", "#00ffd0", "#d0ff00", "#8000ff"],
	},
	{
		id: "plasma-tv",
		name: "Plasma",
		group: "wild",
		blurb: "demoscene default",
		colors: ["#2b0a3d", "#7b2cbf", "#f72585", "#ff8500", "#ffe14d", "#4cc9f0"],
	},
	{
		id: "infrared",
		name: "Infrared Film",
		group: "wild",
		blurb: "foliage goes pink, sky goes cyan",
		colors: ["#ff4fa3", "#ffd1e8", "#8fd6ff", "#1b2a4a", "#ff4fa3"],
	},
	{
		id: "static",
		name: "Dead Channel",
		group: "wild",
		blurb: "the colour of television, tuned to a dead channel",
		colors: ["#000000", "#ffffff", "#2b2b2b", "#e0e0e0", "#101010", "#c0c0c0"],
	},
];

/* ------------------------------------------------------------------ */

const byId = new Map<string, Preset>();
const byAlias = new Map<string, Preset>();
for (const p of PRESETS) {
	byId.set(p.id, p);
	byAlias.set(p.id, p);
	byAlias.set(p.name.toLowerCase(), p);
	for (const a of p.aliases ?? []) byAlias.set(a.toLowerCase(), p);
}

export const DEFAULT_PRESET = "classic";

export function getPreset(id: string | undefined): Preset {
	if (!id) return byId.get(DEFAULT_PRESET)!;
	return byAlias.get(id.trim().toLowerCase()) ?? byId.get(DEFAULT_PRESET)!;
}

export function hasPreset(id: string): boolean {
	return byAlias.has(id.trim().toLowerCase());
}

export function presetIds(): string[] {
	return PRESETS.map((p) => p.id);
}

export function presetsByGroup(): Map<PresetGroup, Preset[]> {
	const out = new Map<PresetGroup, Preset[]>();
	for (const p of PRESETS) {
		const list = out.get(p.group) ?? [];
		list.push(p);
		out.set(p.group, list);
	}
	return out;
}

/** Look a preset up by id or alias. Returns undefined rather than the default. */
export function findPreset(id: string | undefined): Preset | undefined {
	if (!id) return undefined;
	return byAlias.get(id.trim().toLowerCase());
}

/** The next preset in catalogue order, wrapping around. */
export function nextPresetId(current: string): string {
	const ids = presetIds();
	const i = ids.indexOf(findPreset(current)?.id ?? DEFAULT_PRESET);
	return ids[(i + 1 + ids.length) % ids.length]!;
}

/** The previous preset in catalogue order, wrapping around. */
export function prevPresetId(current: string): string {
	const ids = presetIds();
	const i = ids.indexOf(findPreset(current)?.id ?? DEFAULT_PRESET);
	return ids[(i - 1 + ids.length) % ids.length]!;
}

/** Resolve a preset id (or a `#aabbcc,#001122,...` custom list) to stop colours. */
export function resolveStops(idOrCustom: string): RGB[] {
	if (idOrCustom.includes("#") || idOrCustom.includes(",")) {
		const parts = idOrCustom
			.split(/[,\s]+/)
			.map((s) => s.trim())
			.filter(Boolean);
		const cols = parts.filter((p) => /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(p)).map(parseHex);
		if (cols.length >= 2) return cols;
	}
	return getPreset(idOrCustom).colors.map(parseHex);
}

const rampCache = new Map<string, Ramp>();

/** Cached ramp for a preset id or custom colour list. */
export function rampFor(idOrCustom: string): Ramp {
	const key = idOrCustom.trim().toLowerCase();
	const cached = rampCache.get(key);
	if (cached) return cached;
	const custom = key.includes("#") || key.includes(",");
	const cyclic = custom ? true : (getPreset(key).cyclic ?? true);
	const ramp = buildRamp(resolveStops(key), cyclic);
	rampCache.set(key, ramp);
	return ramp;
}
