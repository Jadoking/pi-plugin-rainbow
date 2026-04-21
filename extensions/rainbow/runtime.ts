type Listener = () => void;

const PHASE_RATE_MULTIPLIER = 0.1;
const STOP_SETTLE_CYCLES = 2;

export class RainbowAnimationController {
  private state: "idle" | "running" | "stopping" = "idle";
  private startedAtMs = 0;
  private stopAtMs = 0;
  private listeners = new Set<Listener>();

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(nowMs = Date.now()) {
    if (this.state === "running") {
      return;
    }

    if (this.state === "idle") {
      this.startedAtMs = nowMs;
    }

    this.state = "running";
    this.stopAtMs = 0;
    this.emit();
  }

  stop(speed: number, nowMs = Date.now()) {
    if (this.state === "idle") {
      return;
    }

    if (speed <= 0) {
      this.reset();
      return;
    }

    const elapsedMs = Math.max(0, nowMs - this.startedAtMs);
    const phase = elapsedMs * speed * PHASE_RATE_MULTIPLIER;
    const cycleProgress = phase - Math.floor(phase);
    const remainingCycles = STOP_SETTLE_CYCLES - cycleProgress;
    const remainingMs = remainingCycles / (speed * PHASE_RATE_MULTIPLIER);

    this.state = "stopping";
    this.stopAtMs = nowMs + remainingMs;
    this.emit();
  }

  reset() {
    if (this.state === "idle" && this.startedAtMs === 0 && this.stopAtMs === 0) {
      return;
    }

    this.state = "idle";
    this.startedAtMs = 0;
    this.stopAtMs = 0;
    this.emit();
  }

  isAnimating(nowMs = Date.now()) {
    this.sync(nowMs);
    return this.state !== "idle";
  }

  getElapsedMs(nowMs = Date.now()) {
    this.sync(nowMs);
    if (this.state === "idle") {
      return 0;
    }

    if (this.state === "stopping") {
      return Math.max(0, Math.min(nowMs, this.stopAtMs) - this.startedAtMs);
    }

    return Math.max(0, nowMs - this.startedAtMs);
  }

  private sync(nowMs: number) {
    if (this.state === "stopping" && nowMs >= this.stopAtMs) {
      this.state = "idle";
      this.startedAtMs = 0;
      this.stopAtMs = 0;
      this.emit();
    }
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
