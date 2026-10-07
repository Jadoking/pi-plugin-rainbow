/**
 * Screen layout analysis.
 *
 * pi does not draw boxes with corners; it separates regions with full-width
 * horizontal rules ("────…"). Everything between two rules is a panel: the
 * transcript is the big one at the top, the editor and the footer are the small
 * ones at the bottom, and a tool call pushes another rule in as it runs.
 *
 * Scoping the rainbow to those panels — instead of flooding the whole screen —
 * means the colour lands on the chrome pi actually draws, and the transcript
 * stays legible.
 */

import type { Frame, FrameRow } from "./frame.js";

/** Glyphs pi (and most TUIs) use to draw a horizontal separator. */
const RULE_CHARS = new Set(["─", "━", "═", "–", "—", "-", "▁", "▔", "_"]);

/** Vertical/edge glyphs that count as box chrome when they appear in a row. */
const EDGE_CHARS = new Set(["│", "┃", "║", "▏", "▎", "▌", "┆", "┊", "|"]);

const CORNER_CHARS = new Set(["╭", "╮", "╰", "╯", "┌", "┐", "└", "┘", "├", "┤", "┬", "┴", "┼"]);

/** True when a glyph is part of a box/separator rather than content. */
export function isChromeGlyph(ch: string): boolean {
	return RULE_CHARS.has(ch) || EDGE_CHARS.has(ch) || CORNER_CHARS.has(ch);
}

export type PanelKind =
	/** The scrollback / conversation area: the biggest panel, usually on top. */
	| "transcript"
	/** A rule-delimited block that is not the transcript — editor, footer, tool call. */
	| "panel"
	/** A horizontal separator row. */
	| "rule";

export type Panel = {
	kind: PanelKind;
	top: number;
	bottom: number;
	height: number;
	/** 0..1 position of the panel's centre down the screen, for phase offsets. */
	center: number;
};

export type Layout = {
	panels: Panel[];
	/** Per-row panel index, or -1 when the row sits outside every panel. */
	rowPanel: number[];
	/** Per-row flag: this row is a separator rule. */
	rowRule: boolean[];
	/** Per-row flag: this row carries box chrome (rule, edge or corner glyphs). */
	rowChrome: boolean[];
	ruleRows: number[];
	/** Rows belonging to a background-filled block (pi's tool calls, messages). */
	rowBox: boolean[];
	/** Runs of consecutive box rows. */
	boxes: { top: number; bottom: number }[];
	/** First and last row of each box run — the block's own bracketing rules. */
	rowBoxEdge: boolean[];
};

/**
 * True when a row is mostly made of rule glyphs. pi's separators run the full
 * width, but a tool header can put a label in the middle of one, so this
 * tolerates a minority of other characters rather than demanding purity.
 */
function isRuleRow(row: FrameRow): boolean {
	let rule = 0;
	let other = 0;
	for (const cell of row.cells) {
		const ch = cell.outText;
		if (ch === " " || ch === "") continue;
		if (RULE_CHARS.has(ch) || CORNER_CHARS.has(ch)) rule++;
		else other++;
	}
	if (rule < 8) return false;
	return rule >= (rule + other) * 0.6;
}

/** Horizontal extent of an outlined box, including its border cells. */
export function boxBounds(row: FrameRow): [number, number] | undefined {
	const edges = row.cells.filter((cell) => EDGE_CHARS.has(cell.text) || CORNER_CHARS.has(cell.text));
	const first = edges[0];
	const last = edges.at(-1);
	return first && last && first !== last ? [first.col, last.col] : undefined;
}

export function isBoxCell(row: FrameRow, col: number, bounds: [number, number] | undefined): boolean {
	return row.byCol[col]?.bgCode != null ||
		Boolean(bounds && col >= bounds[0] && col <= bounds[1]);
}

function isBoxRow(row: FrameRow): boolean {
	let filled = 0;
	for (const cell of row.cells) {
		if (cell.style.bgCode !== null) filled++;
	}
	// A handful of cells is a syntax highlight; a block is wider than that.
	return filled >= 6 || boxBounds(row) !== undefined;
}

function hasChrome(row: FrameRow, isRule: boolean): boolean {
	if (isRule) return true;
	for (const cell of row.cells) {
		const ch = cell.outText;
		if (EDGE_CHARS.has(ch) || CORNER_CHARS.has(ch)) return true;
	}
	return false;
}

/**
 * Split the frame into rule-delimited panels.
 *
 * The transcript is identified by size rather than position: it is simply the
 * tallest panel. That holds whether pi is showing a long conversation or a
 * single line, and it survives the editor growing to several rows.
 */
export function analyzeLayout(frame: Frame): Layout {
	const rows = frame.rows;
	const n = rows.length;
	const rowRule: boolean[] = new Array(n).fill(false);
	const rowChrome: boolean[] = new Array(n).fill(false);
	const rowPanel: number[] = new Array(n).fill(-1);
	const rowBox: boolean[] = new Array(n).fill(false);
	const ruleRows: number[] = [];

	for (let y = 0; y < n; y++) {
		const row = rows[y]!;
		if (row.skip) continue;
		const rule = isRuleRow(row);
		rowRule[y] = rule;
		rowChrome[y] = hasChrome(row, rule);
		rowBox[y] = isBoxRow(row);
		if (rule) ruleRows.push(y);
	}

	// Collapse box rows into runs so a caller can reason about whole blocks.
	//
	// The edges matter on their own. pi's editor reads well because two thin
	// rules bracket it and the inside is left alone; a tool block has the same
	// shape, so marking its first and last row lets it be framed the same way
	// instead of being flooded with colour.
	const boxes: { top: number; bottom: number }[] = [];
	const rowBoxEdge: boolean[] = new Array(n).fill(false);
	for (let y = 0; y < n; y++) {
		if (!rowBox[y]) continue;
		const top = y;
		while (y + 1 < n && rowBox[y + 1]) y++;
		boxes.push({ top, bottom: y });
		rowBoxEdge[top] = true;
		rowBoxEdge[y] = true;
	}

	const panels: Panel[] = [];
	const pushPanel = (top: number, bottom: number) => {
		if (bottom < top) return;
		const height = bottom - top + 1;
		panels.push({
			kind: "panel",
			top,
			bottom,
			height,
			center: n > 1 ? (top + bottom) / 2 / (n - 1) : 0.5,
		});
	};

	let cursor = 0;
	for (const y of ruleRows) {
		pushPanel(cursor, y - 1);
		cursor = y + 1;
	}
	pushPanel(cursor, n - 1);

	// Classify. Two panels are transcript, never chrome:
	//   - the one that starts at row 0, because pi's conversation flows from the
	//     top with no rule above it, and
	//   - the tallest one, which is the conversation area in any normal session.
	// Everything else is rule-sandwiched chrome: tool blocks, editor, footer.
	let tallest = -1;
	let tallestH = -1;
	for (let i = 0; i < panels.length; i++) {
		if (panels[i]!.height > tallestH) {
			tallestH = panels[i]!.height;
			tallest = i;
		}
	}
	if (tallest >= 0 && tallestH >= 3) panels[tallest]!.kind = "transcript";
	if (panels.length > 0 && panels[0]!.top === 0 && panels[0]!.height >= 3) {
		panels[0]!.kind = "transcript";
	}

	for (let i = 0; i < panels.length; i++) {
		const p = panels[i]!;
		for (let y = p.top; y <= p.bottom; y++) rowPanel[y] = i;
	}

	return { panels, rowPanel, rowRule, rowChrome, ruleRows, rowBox, boxes, rowBoxEdge };
}

/**
 * How much of the screen the rainbow is allowed to touch.
 *
 * - `screen`  — everything, the old flood-fill behaviour.
 * - `panels`  — message text, filled boxes and separator rules. Empty screen
 *               space, editor contents and the footer keep their own colours.
 * - `chrome`  — the separator rules and box glyphs, nothing else.
 * - `text`    — foregrounds everywhere, no backgrounds at all.
 */
export type RainbowScope = "screen" | "panels" | "chrome" | "text";

export const SCOPES: { id: RainbowScope; blurb: string }[] = [
	{ id: "screen", blurb: "colour the entire screen, background included" },
	{ id: "panels", blurb: "message text, filled boxes and borders only" },
	{ id: "chrome", blurb: "separator rules and box glyphs only" },
	{ id: "text", blurb: "text colours everywhere, no backgrounds" },
];

/**
 * Mark the rows the current scope excludes.
 *
 * `skip` already means "pass this row through verbatim" everywhere else in the
 * pipeline, so reusing it keeps every effect layer honest without each one
 * having to learn about scopes.
 */
export function applyScope(frame: Frame, scope: RainbowScope): Layout {
	const layout = analyzeLayout(frame);
	// The final pair of rules brackets the editor. Preserve its contents in
	// every scope; only the surrounding lines should carry the gradient.
	const editorRules = layout.ruleRows.filter((y) => !boxBounds(frame.rows[y]!));
	const editorTop = editorRules.at(-2);
	const editorBottom = editorRules.at(-1);
	if (editorTop !== undefined && editorBottom !== undefined) {
		for (let y = editorTop + 1; y < editorBottom; y++) frame.rows[y]!.skip = true;
	}
	if (scope === "screen") return layout;

	// Everything below the input box belongs to pi, not to the rainbow.
	//
	// The last rule on screen is the one that closes the editor, so whatever
	// follows it is the status footer: model name, token counts, cost, session
	// id. That is dense information people read at a glance rather than
	// decoration, and colouring it only ever makes it harder to parse. The
	// gradient stops at the input box.
	const lastRule = editorRules.at(-1) ?? -1;
	if (lastRule >= 0) {
		for (let y = lastRule + 1; y < frame.rows.length; y++) {
			frame.rows[y]!.skip = true;
		}
	}

	if (scope === "text") return layout;

	for (let y = 0; y < frame.rows.length; y++) {
		const row = frame.rows[y]!;
		if (row.skip) continue;

		if (scope === "chrome") {
			if (!layout.rowChrome[y]) row.skip = true;
			continue;
		}

		// panels: keep filled boxes and rules; elsewhere colour only text.
		if (layout.rowRule[y]) {
			// A rule is one row tall. Particles landing on it replace the line
			// with scattered glyphs, which reads as a damaged rule rather than
			// as an effect, so the gradient gets it to itself.
			row.quiet = true;
			continue;
		}
		// A background-filled block is a "box" even when it sits in the middle
		// of the transcript, which is exactly where pi puts tool calls. These
		// are the blocks worth colouring, so they override panel classification.
		if (layout.rowBox[y]) continue;
		row.quiet = true;
		if (!row.cells.some((cell) => cell.text.trim())) row.skip = true;
	}

	return layout;
}
