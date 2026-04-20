const TILT = (25 * Math.PI) / 180;
const DX = Math.cos(TILT);
const DY = Math.sin(TILT);

export const FRAME_TICK_MS = 75;
export const DEFAULT_VIBRANCE = 0.35;

export type RGB = {
  r: number;
  g: number;
  b: number;
};

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

export const getRainbowColor = (phase: number, vibrance: number): RGB => {
  const normalizedPhase = phase - Math.floor(phase);
  const palette = getRainbowPalette(vibrance);
  return hslToRgb(normalizedPhase, palette.saturation, palette.lightness);
};

export const offsetRainbowColor = (base: RGB, phase: number, vibrance: number): RGB => {
  const normalizedPhase = phase - Math.floor(phase);
  const hsl = rgbToHsl(base.r, base.g, base.b);
  const palette = getRainbowPalette(vibrance);
  const lowSaturation = hsl.s < 0.12;
  const hue = (lowSaturation ? normalizedPhase : hsl.h + normalizedPhase) % 1;
  const saturationBlend = lowSaturation ? 0.5 : 0.16 + normalizeVibrance(vibrance) * 0.18;
  const lightnessBlend = 0.12 + normalizeVibrance(vibrance) * 0.08;
  const saturation = clamp(mix(hsl.s, palette.saturation, saturationBlend), 0.18, 0.94);
  const lightness = clamp(mix(hsl.l, palette.lightness, lightnessBlend), 0.14, 0.92);

  return hslToRgb(hue < 0 ? hue + 1 : hue, saturation, lightness);
};
