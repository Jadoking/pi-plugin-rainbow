export type RGB = {
  r: number;
  g: number;
  b: number;
};

export type RainbowPreset = {
  id: string;
  name: string;
  description: string;
  colors: readonly RGB[];
  aliases?: readonly string[];
};

const normalizeKey = (value: string) => {
  return value.trim().toLowerCase().replace(/[_\s]+/g, "-");
};

const rgb = (hex: string): RGB => {
  const normalized = hex.replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const preset = (
  id: string,
  name: string,
  description: string,
  colors: readonly string[],
  aliases: readonly string[] = [],
): RainbowPreset => ({
  id,
  name,
  description,
  colors: colors.map(rgb),
  aliases,
});

export const DEFAULT_PRESET_ID = "classic-rainbow";

export const RAINBOW_PRESETS: readonly RainbowPreset[] = [
  preset(
    "classic-rainbow",
    "Classic Rainbow",
    "The original multi-band spectrum, kept as the nostalgic default.",
    ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff4fa3"],
    ["rainbow", "classic", "spectrum"],
  ),
  preset(
    "catppuccin",
    "Catppuccin Mocha",
    "Warm candy accents from the Catppuccin Mocha palette.",
    ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#89dceb", "#74c7ec", "#cba6f7"],
    ["mocha"],
  ),
  preset(
    "dracula",
    "Dracula",
    "The familiar neon-magenta and purple Dracula accent ramp.",
    ["#ff5555", "#ffb86c", "#f1fa8c", "#50fa7b", "#8be9fd", "#bd93f9", "#ff79c6"],
  ),
  preset(
    "gruvbox",
    "Gruvbox",
    "Earthy warm tones with soft greens and blues from Gruvbox dark.",
    ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"],
  ),
  preset(
    "nord",
    "Nord",
    "A cool arctic gradient pulled from Nord's icy accent set.",
    ["#88c0d0", "#81a1c1", "#5e81ac", "#8fbcbb", "#a3be8c", "#ebcb8b", "#d08770", "#bf616a"],
  ),
  preset(
    "tokyo-night",
    "Tokyo Night",
    "High-contrast violet, cyan, and coral accents inspired by Tokyo Night.",
    ["#bb9af7", "#7aa2f7", "#7dcfff", "#73daca", "#9ece6a", "#e0af68", "#f7768e"],
    ["tokyonight"],
  ),
  preset(
    "rose-pine",
    "Rosé Pine",
    "Muted mauves and golds from the Rosé Pine family.",
    ["#ebbcba", "#f6c177", "#31748f", "#9ccfd8", "#c4a7e7", "#ea9a97"],
    ["rosepine"],
  ),
  preset(
    "kanagawa",
    "Kanagawa",
    "Ink-wash reds, golds, greens, and blues from Kanagawa Wave.",
    ["#e46876", "#ffa066", "#dca561", "#98bb6c", "#7fb4ca", "#7e9cd8", "#957fb8"],
  ),
  preset(
    "everforest",
    "Everforest",
    "Forest-toned greens and ambers with calm teal highlights.",
    ["#e67e80", "#e69875", "#dbbc7f", "#a7c080", "#83c092", "#7fbbb3", "#d699b6"],
  ),
  preset(
    "solarized-dark",
    "Solarized Dark",
    "Solarized's balanced accent colors in a continuous loop.",
    ["#dc322f", "#cb4b16", "#b58900", "#859900", "#2aa198", "#268bd2", "#6c71c4", "#d33682"],
    ["solarized"],
  ),
  preset(
    "synthwave-84",
    "Synthwave '84",
    "Hot pinks, golds, and electric blues with arcade energy.",
    ["#ff7edb", "#fe9f6d", "#fede5d", "#72f1b8", "#36f9f6", "#6d77ff", "#c792ea"],
    ["synthwave", "84"],
  ),
  preset(
    "night-owl",
    "Night Owl",
    "Night Owl-inspired blues, greens, and soft gold accents.",
    ["#c792ea", "#82aaff", "#7fdbca", "#21c7a8", "#ecc48d", "#f78c6c", "#ff5874"],
  ),
];

const PRESET_BY_ID = new Map(RAINBOW_PRESETS.map((item) => [item.id, item]));
const PRESET_ALIAS_TO_ID = new Map<string, string>();

for (const item of RAINBOW_PRESETS) {
  PRESET_ALIAS_TO_ID.set(normalizeKey(item.id), item.id);
  PRESET_ALIAS_TO_ID.set(normalizeKey(item.name), item.id);
  for (const alias of item.aliases ?? []) {
    PRESET_ALIAS_TO_ID.set(normalizeKey(alias), item.id);
  }
}

export const getRainbowPreset = (id: string): RainbowPreset => {
  return PRESET_BY_ID.get(id) ?? PRESET_BY_ID.get(DEFAULT_PRESET_ID)!;
};

export const findRainbowPreset = (value: string | undefined): RainbowPreset | undefined => {
  if (!value) return undefined;
  const id = PRESET_ALIAS_TO_ID.get(normalizeKey(value));
  return id ? PRESET_BY_ID.get(id) : undefined;
};

export const normalizePresetId = (value: unknown): string => {
  if (typeof value !== "string") {
    return DEFAULT_PRESET_ID;
  }

  return findRainbowPreset(value)?.id ?? DEFAULT_PRESET_ID;
};

const getPresetIndex = (id: string) => {
  const normalized = normalizePresetId(id);
  const index = RAINBOW_PRESETS.findIndex((item) => item.id === normalized);
  return index >= 0 ? index : 0;
};

export const getNextRainbowPresetId = (id: string) => {
  const index = getPresetIndex(id);
  return RAINBOW_PRESETS[(index + 1) % RAINBOW_PRESETS.length]!.id;
};

export const getPreviousRainbowPresetId = (id: string) => {
  const index = getPresetIndex(id);
  return RAINBOW_PRESETS[(index - 1 + RAINBOW_PRESETS.length) % RAINBOW_PRESETS.length]!.id;
};
