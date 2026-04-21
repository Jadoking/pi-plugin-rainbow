import { mkdirSync, appendFileSync } from "node:fs";
import { dirname } from "node:path";

type RainbowRenderDebugEnv = Partial<Pick<NodeJS.ProcessEnv, "PI_RAINBOW_DEBUG_RENDER" | "PI_RAINBOW_POSTPROCESS_SPIKE" | "PI_RAINBOW_POSTPROCESS_PROBE" | "PI_RAINBOW_POSTPROCESS_ROUNDTRIP" | "PI_RAINBOW_POSTPROCESS_COMPACT">>;

type RainbowDebugRecord = Record<string, unknown>;

const DEFAULT_DEBUG_LOG_PATH = "/tmp/pi-rainbow-render.log";

const isTruthyFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const isFalsyFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
};

export const getRainbowRenderDebugLogPath = (env: RainbowRenderDebugEnv = process.env) => {
  const value = env.PI_RAINBOW_DEBUG_RENDER;
  if (!value || isFalsyFlag(value)) {
    return undefined;
  }

  return isTruthyFlag(value) ? DEFAULT_DEBUG_LOG_PATH : value.trim();
};

export const isRainbowRenderDebugEnabled = (env: RainbowRenderDebugEnv = process.env) => {
  return !!getRainbowRenderDebugLogPath(env);
};

export const isRainbowPostprocessSpikeEnabled = (env: RainbowRenderDebugEnv = process.env) => {
  return isTruthyFlag(env.PI_RAINBOW_POSTPROCESS_SPIKE);
};

export const isRainbowPostprocessProbeEnabled = (env: RainbowRenderDebugEnv = process.env) => {
  return isTruthyFlag(env.PI_RAINBOW_POSTPROCESS_PROBE);
};

export const isRainbowPostprocessRoundtripEnabled = (env: RainbowRenderDebugEnv = process.env) => {
  return isTruthyFlag(env.PI_RAINBOW_POSTPROCESS_ROUNDTRIP);
};

export const isRainbowPostprocessCompactEnabled = (env: RainbowRenderDebugEnv = process.env) => {
  return isTruthyFlag(env.PI_RAINBOW_POSTPROCESS_COMPACT);
};

export const countChangedLines = (previous: string[] | undefined, next: string[]) => {
  const maxLines = Math.max(previous?.length ?? 0, next.length);
  let changed = 0;

  for (let index = 0; index < maxLines; index += 1) {
    if ((previous?.[index] ?? "") !== (next[index] ?? "")) {
      changed += 1;
    }
  }

  return changed;
};

export const logRainbowDebugEvent = (entry: RainbowDebugRecord, env: RainbowRenderDebugEnv = process.env) => {
  const path = getRainbowRenderDebugLogPath(env);
  if (!path) {
    return;
  }

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), pid: process.pid, ...entry })}\n`, "utf8");
};

export const noteRainbowRenderTrigger = (source: string, details?: RainbowDebugRecord, env: RainbowRenderDebugEnv = process.env) => {
  logRainbowDebugEvent({ type: "trigger", source, ...details }, env);
};
