type RainbowAnimationEnv = Partial<Pick<NodeJS.ProcessEnv, "TMUX" | "PI_RAINBOW_FORCE_ANIMATION" | "PI_RAINBOW_DISABLE_ANIMATION">>;
type RainbowAnimationPolicy = {
  animateInTmux?: boolean;
};

const isTruthyFlag = (value: string | undefined) => {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

export const isTmuxSession = (env: RainbowAnimationEnv = process.env) => {
  return !!env.TMUX?.trim();
};

export const isTmuxFriendlyRendering = (env: RainbowAnimationEnv = process.env) => {
  return isTmuxSession(env);
};

export const isRainbowAnimationDisabled = (
  policy: RainbowAnimationPolicy = {},
  env: RainbowAnimationEnv = process.env,
) => {
  if (isTruthyFlag(env.PI_RAINBOW_DISABLE_ANIMATION)) {
    return true;
  }

  if (isTruthyFlag(env.PI_RAINBOW_FORCE_ANIMATION)) {
    return false;
  }

  return isTmuxSession(env) && !policy.animateInTmux;
};

export const getEffectiveAnimationSpeed = (
  speed: number,
  policy: RainbowAnimationPolicy = {},
  env: RainbowAnimationEnv = process.env,
) => {
  return isRainbowAnimationDisabled(policy, env) ? 0 : speed;
};

export const getAnimationSuppressionReason = (
  policy: RainbowAnimationPolicy = {},
  env: RainbowAnimationEnv = process.env,
) => {
  if (isTruthyFlag(env.PI_RAINBOW_DISABLE_ANIMATION)) {
    return "env";
  }

  if (isTruthyFlag(env.PI_RAINBOW_FORCE_ANIMATION)) {
    return undefined;
  }

  return isTmuxSession(env) && !policy.animateInTmux ? "tmux" : undefined;
};
