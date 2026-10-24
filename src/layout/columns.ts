// A table's column widths: fixed, `auto` (its widest line) or `*` (an equal share of what is left).

import type { Cell, Width } from "../document.ts";
import { PdfError } from "../errors.ts";
import { widthOf } from "../text/glyphs.ts";
import type { Run } from "../text/lines.ts";
import { runsOf } from "./paragraph.ts";
import type { Cascade, Styles } from "./style.ts";

/** A cell's text and style, whether it is written as a string or as an object. */
export function cellParts(cell: Cell): Exclude<Cell, string> {
	return typeof cell === "string" ? { text: cell } : cell;
}

/** Each column's width in points, padding included, adding up to at most `available`. */
export function columnWidths(
	styles: Styles,
	cascade: Cascade,
	widths: readonly Width[],
	rows: readonly (readonly Cell[])[],
	paddingX: number,
	available: number,
): number[] {
	const autos = widths.flatMap((width, column) =>
		width === "auto" ? [column] : [],
	);
	const natural = new Map<number, { widest: number; longestWord: number }>();
	for (const column of autos)
		natural.set(column, measureColumn(styles, cascade, rows, column, paddingX));

	const fixed = widths.reduce<number>(
		(sum, width) => sum + (typeof width === "number" ? width : 0),
		0,
	);
	let autoTotal = 0;
	for (const { widest } of natural.values()) autoTotal += widest;
	// Too wide: the auto columns give space back, down to their longest word, in proportion.
	let shrink = 1;
	if (fixed + autoTotal > available && autoTotal > 0) {
		let minimum = 0;
		for (const { longestWord } of natural.values()) minimum += longestWord;
		if (fixed + minimum > available) throw tooWide(fixed + minimum, available);
		shrink = (available - fixed - minimum) / (autoTotal - minimum);
	} else if (fixed > available) throw tooWide(fixed, available);

	const resolved = widths.map((width, column) => {
		if (typeof width === "number") return width;
		const auto = natural.get(column);
		return auto
			? auto.longestWord +
					(auto.widest - auto.longestWord) * Math.min(1, shrink)
			: 0;
	});
	const used = resolved.reduce((sum, width) => sum + width, 0);
	const stars = widths.filter((width) => width === "*").length;
	const share = stars ? Math.max(0, available - used) / stars : 0;
	return resolved.map((width, column) =>
		widths[column] === "*" ? share : width,
	);
}

/** A column's widest line and longest word, over the cells that sit in it alone. */
function measureColumn(
	styles: Styles,
	cascade: Cascade,
	rows: readonly (readonly Cell[])[],
	column: number,
	paddingX: number,
) {
	let widest = 0;
	let longestWord = 0;
	for (const row of rows) {
		const cell = cellAt(row, column);
		if (!cell || (typeof cell !== "string" && (cell.colSpan ?? 1) > 1))
			continue;
		const parts = cellParts(cell);
		const runs = runsOf(
			styles,
			styles.cascade(cascade, parts),
			parts.text,
			undefined,
		);
		widest = Math.max(widest, widestLine(runs));
		for (const run of runs)
			for (const word of run.text.split(/[\s-]/))
				longestWord = Math.max(longestWord, measure(run, word));
	}
	return {
		widest: widest + 2 * paddingX,
		longestWord: longestWord + 2 * paddingX,
	};
}

/** The cell that starts at `column`, counting the columns each cell before it spans. */
export function cellAt(row: readonly Cell[], column: number): Cell | undefined {
	let at = 0;
	for (const cell of row) {
		if (at === column) return cell;
		at += typeof cell === "string" ? 1 : (cell.colSpan ?? 1);
		if (at > column) return undefined;
	}
	return undefined;
}

function widestLine(runs: readonly Run[]): number {
	let widest = 0;
	let line = 0;
	for (const run of runs) {
		const [first = "", ...rest] = run.text.split("\n");
		line += measure(run, first);
		for (const next of rest) {
			widest = Math.max(widest, line);
			line = measure(run, next);
		}
	}
	return Math.max(widest, line);
}

const measure = (run: Run, text: string) =>
	widthOf(run.style.use.face, text, run.style.size);

function tooWide(needed: number, available: number): PdfError {
	return new PdfError(
		"table-too-wide",
		`The table needs ${Math.ceil(needed)} points across, and the page has ${Math.floor(available)}. Narrow its fixed columns, or make some of them "*".`,
	);
}
