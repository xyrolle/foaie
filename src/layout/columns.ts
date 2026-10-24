// A table's column widths: fixed, `auto` (its widest line) or `*` (an equal share of what is left).

import type { Cell, Width } from "../document.ts";
import { PdfError } from "../errors.ts";
import { naturalWidths } from "../text/lines.ts";
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
		if (!cell || spanOf(cell) > 1) continue;
		const parts = cellParts(cell);
		const natural = naturalWidths(
			runsOf(styles, styles.cascade(cascade, parts), parts.text, undefined),
		);
		widest = Math.max(widest, natural.widest);
		longestWord = Math.max(longestWord, natural.longestWord);
	}
	return {
		widest: widest + 2 * paddingX,
		longestWord: longestWord + 2 * paddingX,
	};
}

/** How many columns a cell spans. */
export const spanOf = (cell: Cell): number =>
	typeof cell === "string" ? 1 : (cell.colSpan ?? 1);

/** Throws unless each row's cells span the table's columns exactly, each a whole number of them. */
export function checkSpans(
	header: readonly (readonly Cell[])[],
	rows: readonly (readonly Cell[])[],
	columns: number,
): void {
	const check = (row: readonly Cell[], name: string) => {
		let spanned = 0;
		for (const cell of row) {
			const span = spanOf(cell);
			if (!Number.isInteger(span) || span < 1)
				throw new PdfError(
					"block-invalid",
					`A cell in ${name} of a table has colSpan ${span}. Make it a whole number of columns, 1 or more.`,
				);
			spanned += span;
		}
		if (spanned !== columns)
			throw new PdfError(
				"block-invalid",
				`The cells in ${name} of a table span ${counted(spanned)}, and its widths make ${counted(columns)}. Give the row cells that span all ${columns}.`,
			);
	};
	for (const [i, row] of header.entries()) check(row, `header row ${i + 1}`);
	for (const [i, row] of rows.entries()) check(row, `row ${i + 1}`);
}

const counted = (columns: number) =>
	columns === 1 ? "1 column" : `${columns} columns`;

/** The cell that starts at `column`, counting the columns each cell before it spans. */
function cellAt(row: readonly Cell[], column: number): Cell | undefined {
	let at = 0;
	for (const cell of row) {
		if (at === column) return cell;
		at += spanOf(cell);
		if (at > column) return undefined;
	}
	return undefined;
}

function tooWide(needed: number, available: number): PdfError {
	return new PdfError(
		"table-too-wide",
		`The table needs ${Math.ceil(needed)} points across, and the page has ${Math.floor(available)}. Narrow its fixed columns, or make some of them "*".`,
	);
}
