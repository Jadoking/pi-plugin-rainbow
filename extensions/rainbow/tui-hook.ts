/**
 * The hook into pi-tui.
 *
 * pi-tui funnels every frame through `applyLineResets(screen)` as the last
 * transform before diffing against the previous frame, in both the alt-screen
 * and the main-screen renderers. That is the one place where the complete,
 * fully-composited screen exists as an array of strings — so that is where the
 * rainbow goes.
 *
 * `applyLineResets` is also called once from `afterTerminalStop` to produce the
 * scrollback dump, which must stay untouched; the `inRender` flag distinguishes
 * the two.
 */

import type { RainbowEngine } from "./engine.js";
import { parseHex, type RGB } from "./color.js";
import type { RainbowSettings } from "./settings.js";
import { isRainbowAnimationDisabled } from "./terminal.js";

/** Structural type for the bits of pi-tui we touch, so we do not depend on its class shapes. */
type HookableTui = {
	mode?: string;
	terminal?: { columns?: number; rows?: number };
	requestRender?: (force?: boolean) => void;
	hasOverlay?: () => boolean;
	applyLineResets?: (lines: string[]) => string[];
	doRender?: () => void;
	extractCursorPosition?: (lines: string[], height: number) => { row: number; col: number } | null;
	onTerminalColorSchemeChange?: (listener: (scheme: unknown) => void) => () => void;
};

type Patched = HookableTui & {
	__rainbowPatched?: boolean;
	__rainbowRestore?: () => void;
};

export type HookOptions = {
	engine: RainbowEngine;
	getSettings: () => RainbowSettings;
	/** Called with the measured frame cost, for the status line. */
	onFrame?: (ms: number) => void;
};

export class RainbowTuiHook {
	private tui: Patched | null = null;
	private readonly opts: HookOptions;
	private inRender = false;
	private cursor: { x: number; y: number } | null = null;
	private timer: NodeJS.Timeout | null = null;
	private currentFps = 0;
	private disposed = false;

	constructor(opts: HookOptions) {
		this.opts = opts;
	}

	get attached(): boolean {
		return this.tui !== null;
	}

	get isFullscreen(): boolean {
		return this.tui?.mode === "fullscreen";
	}

	/** Terminal size, for commands that want to report it. */
	get size(): { width: number; height: number } {
		return {
			width: Math.max(1, this.tui?.terminal?.columns ?? 80),
			height: Math.max(1, this.tui?.terminal?.rows ?? 24),
		};
	}

	attach(tui: unknown): void {
		if (this.disposed) return;
		const t = tui as Patched;
		if (!t || typeof t.applyLineResets !== "function") return;
		if (t.__rainbowPatched) {
			this.tui = t;
			this.restartPump();
			return;
		}

		const originalApply = t.applyLineResets.bind(t);
		const originalDoRender = typeof t.doRender === "function" ? t.doRender.bind(t) : null;
		const originalExtract =
			typeof t.extractCursorPosition === "function" ? t.extractCursorPosition.bind(t) : null;

		t.applyLineResets = (lines: string[]): string[] => {
			const base = originalApply(lines);
			if (!this.inRender) return base;
			return this.transform(base);
		};

		if (originalDoRender) {
			t.doRender = (): void => {
				this.inRender = true;
				try {
					originalDoRender();
				} finally {
					this.inRender = false;
				}
			};
		}

		if (originalExtract) {
			t.extractCursorPosition = (lines: string[], height: number) => {
				const pos = originalExtract(lines, height);
				this.cursor = pos ? { x: pos.col, y: pos.row } : null;
				return pos;
			};
		}

		t.__rainbowPatched = true;
		t.__rainbowRestore = () => {
			t.applyLineResets = originalApply;
			if (originalDoRender) t.doRender = originalDoRender;
			if (originalExtract) t.extractCursorPosition = originalExtract;
			t.__rainbowPatched = false;
			t.__rainbowRestore = undefined;
		};

		this.tui = t;
		this.subscribeTheme(t);
		this.restartPump();
	}

	detach(): void {
		this.stopPump();
		const t = this.tui;
		this.tui = null;
		t?.__rainbowRestore?.();
	}

	dispose(): void {
		this.disposed = true;
		this.detach();
	}

	/** Force an immediate repaint (after a settings change, say). */
	refresh(): void {
		this.tui?.requestRender?.(true);
	}

	/* ---------------------------------------------------------------- */

	private transform(lines: string[]): string[] {
		const tui = this.tui;
		if (!tui) return lines;
		const s = this.opts.getSettings();
		if (!s.enabled) return lines;

		const fullscreen = tui.mode === "fullscreen";
		if (!fullscreen && s.regularMode === "off") return lines;

		const width = Math.max(1, tui.terminal?.columns ?? 80);
		const height = Math.max(1, tui.terminal?.rows ?? lines.length);

		// In the main-screen renderer `lines` is only the newly appended block,
		// not a whole screen; never pad those or the scrollback grows sideways.
		const padFullWidth = fullscreen && s.fullBleed;

		const started = performance.now();
		const out = this.opts.engine.process(lines, {
			width,
			height: fullscreen ? height : lines.length,
			fullscreen: padFullWidth,
			cursor: this.cursor,
			overlayVisible: tui.hasOverlay?.() ?? false,
		});
		this.opts.onFrame?.(performance.now() - started);
		return out;
	}

	private subscribeTheme(tui: Patched): void {
		try {
			tui.onTerminalColorSchemeChange?.((scheme) => {
				const s = scheme as { background?: string; foreground?: string } | undefined;
				const bg = s?.background ? safeHex(s.background) : null;
				const fg = s?.foreground ? safeHex(s.foreground) : null;
				this.opts.engine.setTheme(bg, fg);
			});
		} catch {
			// Terminal does not support colour queries — the defaults are fine.
		}
	}

	/* ---------------------------------------------------------------- *
	 * Animation pump
	 * ---------------------------------------------------------------- */

	private targetFps(): number {
		const s = this.opts.getSettings();
		if (!s.enabled) return 0;
		if (isRainbowAnimationDisabled({ animateInTmux: s.animateInTmux })) return 0;
		if (s.speed <= 0 && Object.keys(s.fx).length === 0) return 0;

		const idle = this.opts.engine.idleSeconds;
		if (!s.alwaysAnimate && idle > s.idleAfter) return 0;
		if (idle > s.idleAfter) return s.idleFps;
		return s.reducedMotion ? Math.min(s.fps, 12) : s.fps;
	}

	/** Re-evaluate the frame rate; call after any settings change. */
	restartPump(): void {
		const fps = this.targetFps();
		if (fps === this.currentFps && this.timer) return;
		this.stopPump();
		this.currentFps = fps;
		if (fps <= 0 || !this.tui) return;
		const interval = Math.max(16, Math.round(1000 / fps));
		this.timer = setInterval(() => {
			// Idle/active transitions change the target rate; re-arm when it moves.
			if (this.targetFps() !== this.currentFps) {
				this.restartPump();
				return;
			}
			this.tui?.requestRender?.();
		}, interval);
		this.timer.unref?.();
	}

	private stopPump(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = null;
		}
		this.currentFps = 0;
	}

	get fps(): number {
		return this.currentFps;
	}
}

function safeHex(value: string): RGB | null {
	try {
		const hex = value.trim().replace(/^#/, "");
		if (!/^[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(hex)) return null;
		return parseHex(hex);
	} catch {
		return null;
	}
}
