import { DEFAULT_PRESET_ID, getRainbowPreset, type RGB as PresetRGB } from "./presets.js";

const TILT = (25 * Math.PI) / 180;
const DX = Math.cos(TILT);
const DY = Math.sin(TILT);

export const FRAME_TICK_MS = 33;
export const DEFAULT_VIBRANCE = 0.35;

export type RGB = PresetRGB;

export type RainbowMotion = {
  columnStep: number;
  rowStep: number;
  phaseShift: number;
};

const clamp = (value: number, min: number, max: number) => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const mix = (from: number, to: number, strength: number) => {
  return from + (to - from) * strength;
};

const hueToRgb = (p: number, q: number, t: number) => {
  let next = t;

  if (next < 0) next += 1;
  if (next > 1) next -= 1;
  if (next < 1 / 6) return p + (q - p) * 6 * next;
  if (next < 1 / 2) return q;
  if (next < 2 / 3) return p + (q - p) * (2 / 3 - next) * 6;
  return p;
};

const hslToRgb = (h: number, s: number, l: number): RGB => {
  if (s === 0) {
    const value = Math.round(l * 255);
    return { r: value, g: value, b: value };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hueToRgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hueToRgb(p, q, h) * 255),
    b: Math.round(hueToRgb(p, q, h - 1 / 3) * 255),
  };
};

const rgbToHsl = (r: number, g: number, b: number) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;

  if (delta === 0) {
    return { h: 0, s: 0, l: lightness };
  }

  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;

  switch (max) {
    case red:
      hue = (green - blue) / delta + (green < blue ? 6 : 0);
      break;
    case green:
      hue = (blue - red) / delta + 2;
      break;
    default:
      hue = (red - green) / delta + 4;
      break;
  }

  return { h: hue / 6, s: saturation, l: lightness };
};

const mixRgb = (from: RGB, to: RGB, strength: number): RGB => ({
  r: Math.round(mix(from.r, to.r, strength)),
  g: Math.round(mix(from.g, to.g, strength)),
  b: Math.round(mix(from.b, to.b, strength)),
});

const normalizeHue = (value: number) => {
  let next = value % 1;
  if (next < 0) next += 1;
  return next;
};

const mixHue = (from: number, to: number, strength: number) => {
  const a = normalizeHue(from);
  const b = normalizeHue(to);
  let delta = b - a;

  if (delta > 0.5) delta -= 1;
  if (delta < -0.5) delta += 1;

  return normalizeHue(a + delta * strength);
};

const samplePresetColor = (phase: number, presetId: string): RGB => {
  const colors = getRainbowPreset(presetId).colors;
  if (colors.length === 0) {
    return { r: 255, g: 255, b: 255 };
  }

  if (colors.length === 1) {
    return colors[0]!;
  }

  const normalizedPhase = phase - Math.floor(phase);
  const scaled = normalizedPhase * colors.length;
  const index = Math.floor(scaled) % colors.length;
  const nextIndex = (index + 1) % colors.length;
  const strength = scaled - Math.floor(scaled);

  return mixRgb(colors[index]!, colors[nextIndex]!, strength);
};

export const normalizeVibrance = (value: number) => {
  return clamp(value, 0, 1);
};

export const getRainbowPalette = (vibrance: number) => {
  const normalized = normalizeVibrance(vibrance);

  return {
    saturation: 0.42 + normalized * 0.4,
    lightness: 0.82 - normalized * 0.18,
  };
};

export const getFrameBucket = (elapsedMs: number) => {
  return Math.floor(elapsedMs / FRAME_TICK_MS);
};

export const frameBucketToElapsedMs = (frame: number) => {
  return frame * FRAME_TICK_MS;
};

export const createRainbowMotion = (
  surfaceWidth: number,
  surfaceHeight: number,
  turns: number,
  elapsedMs: number,
  speed: number,
  phaseSeed = 0,
): RainbowMotion => {
  const span = Math.max(1, surfaceWidth * DX + surfaceHeight * DY);

  return {
    columnStep: (DX * turns) / span,
    rowStep: (DY * turns) / span,
    phaseShift: phaseSeed + elapsedMs * speed * 0.1,
  };
};

export const phaseAt = (motion: RainbowMotion, row: number, column: number) => {
  return motion.phaseShift + row * motion.rowStep + column * motion.columnStep;
};

export const getRainbowColor = (phase: number, presetId = DEFAULT_PRESET_ID, vibrance = DEFAULT_VIBRANCE): RGB => {
  if (presetId !== DEFAULT_PRESET_ID) {
    return samplePresetColor(phase, presetId);
  }

  const normalizedPhase = phase - Math.floor(phase);
  const palette = getRainbowPalette(vibrance);
  return hslToRgb(normalizedPhase, palette.saturation, palette.lightness);
};

export const offsetRainbowColor = (
  base: RGB,
  phase: number,
  presetId = DEFAULT_PRESET_ID,
  vibrance = DEFAULT_VIBRANCE,
): RGB => {
  const target = getRainbowColor(phase, presetId, vibrance);
  const baseHsl = rgbToHsl(base.r, base.g, base.b);
  const targetHsl = rgbToHsl(target.r, target.g, target.b);
  const lowSaturation = baseHsl.s < 0.12;
  const hue = lowSaturation ? targetHsl.h : mixHue(baseHsl.h, targetHsl.h, presetId === DEFAULT_PRESET_ID ? 1 : 0.35);
  const saturationBlend = lowSaturation ? 0.5 : presetId === DEFAULT_PRESET_ID ? 0.22 + normalizeVibrance(vibrance) * 0.14 : 0.28;
  const lightnessBlend = presetId === DEFAULT_PRESET_ID ? 0.12 + normalizeVibrance(vibrance) * 0.08 : 0.16;
  const saturation = clamp(mix(baseHsl.s, targetHsl.s, saturationBlend), 0.18, 0.94);
  const lightness = clamp(mix(baseHsl.l, targetHsl.l, lightnessBlend), 0.14, 0.92);

  return hslToRgb(hue, saturation, lightness);
};

export const offsetRainbowBackgroundColor = (
  base: RGB,
  phase: number,
  presetId = DEFAULT_PRESET_ID,
  vibrance = DEFAULT_VIBRANCE,
): RGB => {
  const target = getRainbowColor(phase, presetId, vibrance);
  const baseHsl = rgbToHsl(base.r, base.g, base.b);
  const targetHsl = rgbToHsl(target.r, target.g, target.b);
  const normalizedPhase = normalizeHue(phase);
  const bandPulse = (1 - Math.cos(normalizedPhase * Math.PI * 2)) / 2;
  const lowSaturation = baseHsl.s < 0.12;
  const hue = mixHue(baseHsl.h, targetHsl.h, lowSaturation ? 0.92 : presetId === DEFAULT_PRESET_ID ? 0.72 : 0.58);
  const saturationTarget = Math.max(baseHsl.s, targetHsl.s * (0.52 + normalizeVibrance(vibrance) * 0.18));
  const saturation = clamp(mix(baseHsl.s, saturationTarget, lowSaturation ? 0.78 : 0.48), 0.12, 0.78);
  const lightness = clamp(baseHsl.l + 0.02 + bandPulse * (0.08 + normalizeVibrance(vibrance) * 0.03), 0.09, 0.38);

  return hslToRgb(hue, saturation, lightness);
};
