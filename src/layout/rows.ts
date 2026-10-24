// A table's rows once laid out: drawn with their fills, text and borders, or split between lines
// when a page can't hold them.

import type { Align, Sides } from "../document.ts";
import type { Line } from "../text/lines.ts";
import type { PageContent } from "./page.ts";
import { heightOf, lineStart } from "./paragraph.ts";

export type LaidCell = {
	x: number;
	width: number;
	lines: Line[];
	align: Align | undefined;
	fill: string | undefined;
	sides: Sides<boolean>;
};

/** A row laid out; `uniform` when every cell has the table's own sides. */
export type LaidRow = { cells: LaidCell[]; height: number; uniform: boolean };

/** How a table pads its cells, and how it strokes their borders. */
export type RowStyle = { padding: { x: number; y: number }; stroke: string };

const rowOf = (
	cells: LaidCell[],
	uniform: boolean,
	{ padding }: RowStyle,
): LaidRow => ({
	cells,
	height:
		Math.max(...cells.map((cell) => heightOf(cell.lines))) + 2 * padding.y,
	uniform,
});

/** The lines of a row that fit `room`, and the row of the lines left over; none fit, no first part. */
export function splitRow(
	row: LaidRow,
	room: number,
	style: RowStyle,
): [LaidRow | undefined, LaidRow] {
	const available = room - 2 * style.padding.y;
	const taken: LaidCell[] = [];
	const left: LaidCell[] = [];
	for (const cell of row.cells) {
		let used = 0;
		let count = 0;
		for (const line of cell.lines) {
			if (used + line.height > available) break;
			used += line.height;
			count++;
		}
		taken.push({ ...cell, lines: cell.lines.slice(0, count) });
		left.push({ ...cell, lines: cell.lines.slice(count) });
	}
	if (taken.every((cell) => cell.lines.length === 0)) return [undefined, row];
	return [rowOf(taken, row.uniform, style), rowOf(left, row.uniform, style)];
}

/** Draws a row whose top is at `top`: fills first, then text, then borders over both. */
export function drawRow(
	page: PageContent,
	row: LaidRow,
	top: number,
	style: RowStyle,
): void {
	const { padding } = style;
	for (const cell of row.cells)
		if (cell.fill) page.fill(cell.x, top, cell.width, row.height, cell.fill);
	for (const cell of row.cells) {
		let y = top + padding.y;
		for (const line of cell.lines) {
			page.text(
				line,
				lineStart(
					line,
					cell.x + padding.x,
					cell.width - 2 * padding.x,
					cell.align,
				),
				y,
			);
			y += line.height;
		}
	}
	drawBorders(page, row, top, style.stroke);
}

function drawBorders(
	page: PageContent,
	row: LaidRow,
	top: number,
	stroke: string,
): void {
	const bottom = top + row.height;
	const rule = (x1: number, y1: number, x2: number, y2: number) =>
		page.line(x1, y1, x2, y2, stroke);
	const first = row.cells[0];
	const last = row.cells.at(-1);
	if (row.uniform && first && last) {
		// Every cell has the same sides: each edge is one stroke, however many cells share it.
		const right = last.x + last.width;
		if (first.sides.top) rule(first.x, top, right, top);
		if (first.sides.bottom) rule(first.x, bottom, right, bottom);
		if (first.sides.left)
			for (const cell of row.cells) rule(cell.x, top, cell.x, bottom);
		if (first.sides.right) rule(right, top, right, bottom);
		return;
	}
	for (const cell of row.cells) {
		const right = cell.x + cell.width;
		if (cell.sides.top) rule(cell.x, top, right, top);
		if (cell.sides.bottom) rule(cell.x, bottom, right, bottom);
		if (cell.sides.left) rule(cell.x, top, cell.x, bottom);
		if (cell.sides.right) rule(right, top, right, bottom);
	}
}
