/**
 * Dense, mutable frame buffer built on top of the ANSI line parser.
 *
 * Effects never touch strings — they read and write `FrameCell`s on a
 * column-addressed grid, and `emitFrame` turns that back into terminal output
 * exactly once per frame.
 */

import {
	type AnsiCell,
	type AnsiGridLine,
	colorCodeToRgb,
	parseAnsiLine,
	styleStateToAnsi,
} from "./ansi-grid.js";
import { clamp255, type RGB } from "./color.js";

export type FrameCell = AnsiCell & {
	/** Starting column of this cell (wide glyphs occupy `width` columns). */
	col: number;
	/** True when the glyph is whitespace and there is no background colour. */
	blank: boolean;
	/** Mutable output overrides. `null` means "no colour", `undefined` means "unset". */
	outText: string;
	outFg: RGB | null;
	outBg: RGB | null;
	outBold: boolean;
	outDim: boolean;
	outItalic: boolean;
	outUnderline: boolean;
	outInverse: boolean;
	/** Set by effects that own a cell outright (particles) so later layers leave it alone. */
	claimed: boolean;
};

export type FrameRow = {
	index: number;
	/** Original text; used verbatim when `skip` is set. */
	raw: string;
	line: AnsiGridLine;
	cells: FrameCell[];
	/** Column → cell lookup. Wide glyphs map every covered column to the same cell. */
	byCol: (FrameCell | undefined)[];
	/** Visible width of the original content. */
	used: number;
	/** Image / unknown-protocol rows are passed through untouched. */
	skip: boolean;
	/** Set when any cell changed, so unchanged rows can keep their original string. */
	dirty: boolean;
};

export type Frame = {
	width: number;
	height: number;
	rows: FrameRow[];
	/** Cursor position reported by the TUI, if known (column, row). */
	cursor: { x: number; y: number } | null;
};

const IMAGE_MARKERS = ["\x1b_G", "\x1b]1337;File=", "\x1bPtmux;", "\x1b]1337;MultipartFile="];

export function isPassThroughLine(line: string): boolean {
	if (line.length === 0) return false;
	for (const marker of IMAGE_MARKERS) if (line.includes(marker)) return true;
	return false;
}

const SPACE_RE = /^[\s\u00a0]*$/;

function makeCell(src: AnsiCell, col: number): FrameCell {
	const blank = src.bgCode === null && SPACE_RE.test(src.text);
	return Object.assign(src, {
		col,
		blank,
		outText: src.text,
		outFg: src.fg,
		outBg: src.bg,
		outBold: src.style.bold,
		outDim: src.style.dim,
		outItalic: src.style.italic,
		outUnderline: src.style.underline,
		outInverse: src.style.inverse,
		claimed: false,
	}) as FrameCell;
}

/**
 * A synthetic blank cell used to pad rows out to the full terminal width.
 * Built from scratch rather than parsed — this runs width-minus-used times per
 * row per frame and parsing a space here showed up in profiles.
 */
function padCell(col: number): FrameCell {
	return {
		text: " ",
		width: 1,
		before: "",
		beforeNonSgr: "",
		fgCode: null,
		bgCode: null,
		fg: null,
		bg: null,
		style: {
			bold: false,
			dim: false,
			italic: false,
			underline: false,
			blink: false,
			inverse: false,
			hidden: false,
			strike: false,
			overline: false,
			fgCode: null,
			bgCode: null,
		},
		styleKey: "",
		styleAnsi: "",
		col,
		blank: true,
		outText: " ",
		outFg: null,
		outBg: null,
		outBold: false,
		outDim: false,
		outItalic: false,
		outUnderline: false,
		outInverse: false,
		claimed: false,
	};
}

/**
 * Parse screen lines into a frame.
 *
 * `padTo` pads every row out to the terminal width with blank cells so
 * background effects reach the screen edges. Rows that contain image escape
 * sequences are flagged `skip` and emitted verbatim.
 */
export function buildFrame(lines: string[], width: number, height: number, padTo = true): Frame {
	const rows: FrameRow[] = new Array(lines.length);
	for (let i = 0; i < lines.length; i++) {
		const raw = lines[i] ?? "";
		if (isPassThroughLine(raw)) {
			rows[i] = {
				index: i,
				raw,
				line: { prefix: "", prefixNonSgr: "", cells: [], suffix: "", suffixNonSgr: "", visibleWidth: 0 },
				cells: [],
				byCol: [],
				used: 0,
				skip: true,
				dirty: false,
			};
			continue;
		}

		const parsed = parseAnsiLine(raw);
		const cells: FrameCell[] = new Array(parsed.cells.length);
		const byCol: (FrameCell | undefined)[] = new Array(width);
		let col = 0;
		for (let c = 0; c < parsed.cells.length; c++) {
			const cell = makeCell(parsed.cells[c]!, col);
			cells[c] = cell;
			for (let k = 0; k < cell.width && col + k < width; k++) byCol[col + k] = cell;
			col += cell.width;
		}
		const used = col;

		if (padTo && col < width) {
			for (; col < width; col++) {
				const cell = padCell(col);
				cells.push(cell);
				byCol[col] = cell;
			}
		}

		rows[i] = { index: i, raw, line: parsed, cells, byCol, used, skip: false, dirty: padTo && used < width };
	}

	return { width, height, rows, cursor: null };
}

/** Cell at a column/row, or undefined. Effects use this for neighbourhood lookups. */
export function cellAt(frame: Frame, x: number, y: number): FrameCell | undefined {
	if (y < 0 || y >= frame.rows.length || x < 0 || x >= frame.width) return undefined;
	const row = frame.rows[y]!;
	return row.skip ? undefined : row.byCol[x];
}

const fgSeq = (c: RGB): string => `38;2;${clamp255(c.r)};${clamp255(c.g)};${clamp255(c.b)}`;
const bgSeq = (c: RGB): string => `48;2;${clamp255(c.r)};${clamp255(c.g)};${clamp255(c.b)}`;

function cellSgr(cell: FrameCell): string {
	const parts: string[] = [];
	if (cell.outBold) parts.push("1");
	if (cell.outDim) parts.push("2");
	if (cell.outItalic) parts.push("3");
	if (cell.outUnderline) parts.push("4");
	if (cell.style.blink) parts.push("5");
	if (cell.outInverse) parts.push("7");
	if (cell.style.strike) parts.push("9");
	if (cell.style.overline) parts.push("53");
	if (cell.outFg) parts.push(fgSeq(cell.outFg));
	else if (cell.style.fgCode) parts.push(cell.style.fgCode);
	if (cell.outBg) parts.push(bgSeq(cell.outBg));
	else if (cell.style.bgCode) parts.push(cell.style.bgCode);
	return parts.length ? `\x1b[0;${parts.join(";")}m` : "\x1b[0m";
}

const RESET = "\x1b[0m";

/** Serialise one row back to a terminal line. */
export function emitRow(row: FrameRow): string {
	if (row.skip) return row.raw;
	if (!row.dirty) return row.raw;

	let out = row.line.prefixNonSgr;
	let prev = "";
	for (let i = 0; i < row.cells.length; i++) {
		const cell = row.cells[i]!;
		if (cell.beforeNonSgr) {
			out += cell.beforeNonSgr;
			prev = "";
		}
		const sgr = cellSgr(cell);
		if (sgr !== prev) {
			out += sgr;
			prev = sgr;
		}
		out += cell.outText;
	}
	out += row.line.suffixNonSgr;
	if (prev !== "" && prev !== RESET) out += RESET;
	return out;
}

export function emitFrame(frame: Frame): string[] {
	const out: string[] = new Array(frame.rows.length);
	for (let i = 0; i < frame.rows.length; i++) out[i] = emitRow(frame.rows[i]!);
	return out;
}

/** Mark a row dirty. Effects must call this (or `setCell*`) or their work is dropped. */
export function touch(row: FrameRow): void {
	row.dirty = true;
}

export function setFg(frame: Frame, cell: FrameCell, row: FrameRow, color: RGB | null): void {
	cell.outFg = color;
	row.dirty = true;
	void frame;
}

/** Resolve the effective background of a cell, falling back to the terminal default. */
export function effectiveBg(cell: FrameCell, fallback: RGB): RGB {
	return cell.outBg ?? colorCodeToRgb(cell.style.bgCode) ?? fallback;
}

export { styleStateToAnsi };
