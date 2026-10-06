/**
 * The splash overlay — a short, loud "yes, the rainbow is on" animation.
 *
 * It renders its banner through a private engine instance rather than the live
 * one, so the splash looks the same whatever the session's settings happen to
 * be at the time.
 */

import { RainbowEngine } from "./engine.js";
import { DEFAULT_SETTINGS, type RainbowSettings } from "./settings.js";

const BANNER = [
	"██████╗  █████╗ ██╗███╗   ██╗██████╗  ██████╗ ██╗    ██╗",
	"██╔══██╗██╔══██╗██║████╗  ██║██╔══██╗██╔═══██╗██║    ██║",
	"██████╔╝███████║██║██╔██╗ ██║██████╔╝██║   ██║██║ █╗ ██║",
	"██╔══██╗██╔══██║██║██║╚██╗██║██╔══██╗██║   ██║██║███╗██║",
	"██║  ██║██║  ██║██║██║ ╚████║██████╔╝╚██████╔╝╚███╔███╔╝",
	"╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝  ╚══╝╚══╝ ",
];

type SplashCtx = {
	hasUI?: boolean;
	ui: {
		custom: <T>(
			factory: (
				tui: unknown,
				theme: unknown,
				keybindings: unknown,
				done: (result: T) => void,
			) => {
				render: (width: number) => string[];
				handleInput?: (d: string) => void;
				dispose?: () => void;
			},
			options?: { overlay?: boolean },
		) => Promise<T>;
	};
};

export async function showRainbowSplash(ctx: unknown, settings: RainbowSettings): Promise<void> {
	const c = ctx as SplashCtx;
	if (typeof c?.ui?.custom !== "function") return;

	const splashSettings: RainbowSettings = {
		...DEFAULT_SETTINGS,
		preset: settings.preset,
		enabled: true,
		mode: "diagonal",
		motion: "scroll",
		speed: 0.5,
		turns: 1.4,
		blend: 1,
		colorText: true,
		colorBackground: true,
		fx: { starfield: 0.45, shine: 0.7, bloom: 0.5, neon: 0.6, vignette: 0.4 },
	};

	const engine = new RainbowEngine(splashSettings);
	const bannerWidth = Math.max(...BANNER.map((l) => [...l].length));

	await c.ui.custom<void>(
		(tui, _theme, _kb, done) => {
			let closed = false;
			const close = () => {
				if (closed) return;
				closed = true;
				clearInterval(timer);
				done();
			};

			const timer = setInterval(() => {
				(tui as { requestRender?: () => void })?.requestRender?.();
			}, 50);
			timer.unref?.();
			const stopAt = Date.now() + 2800;

			return {
				render(width: number): string[] {
					if (Date.now() > stopAt) {
						// Resolve on the next tick: never call done() mid-render.
						setTimeout(close, 0);
					}
					const inner = Math.max(24, Math.min(width - 2, bannerWidth + 6));
					const body: string[] = [""];
					for (const line of BANNER) {
						const pad = Math.max(0, Math.floor((inner - [...line].length) / 2));
						body.push(" ".repeat(pad) + line);
					}
					body.push("");
					const tag = "81 palettes · 16 fields · 34 effects";
					body.push(" ".repeat(Math.max(0, Math.floor((inner - tag.length) / 2))) + tag);
					const hint = "any key to dismiss";
					body.push(" ".repeat(Math.max(0, Math.floor((inner - hint.length) / 2))) + hint);
					body.push("");

					return engine.process(body, {
						width: inner,
						height: body.length,
						fullscreen: true,
						cursor: null,
						overlayVisible: false,
					});
				},
				handleInput: close,
				dispose: close,
			};
		},
		{ overlay: true },
	);
}
