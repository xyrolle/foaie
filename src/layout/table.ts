// A table set down the flow a row at a time: its header repeated on every page it continues on,
// each row moved whole to the next page when it fits on one, and split between lines when it can't.

import type { Cell, Sides, Table, TextStyle } from "../document.ts";
import type { PdfError } from "../errors.ts";
import { breakLines, type Line } from "../text/lines.ts";
import { cellParts, checkSpans, columnWidths, spanOf } from "./columns.ts";
import { type Flow, pageTooSmall } from "./flow.ts";
import { stroke } from "./page.ts";
import { heightOf, runsOf } from "./paragraph.ts";
import {
	drawRow,
	type LaidCell,
	type LaidRow,
	type RowStyle,
	splitRow,
} from "./rows.ts";
import type { Cascade, Style, Styles } from "./style.ts";

const STYLE_KEYS = [
	"font",
	"size",
	"bold",
	"italic",
	"color",
	"lineHeight",
] as const;
const setsStyle = (style: TextStyle) =>
	STYLE_KEYS.some((key) => style[key] !== undefined);

const NO_SIDES: Sides<boolean> = {
	top: false,
	right: false,
	bottom: false,
	left: false,
};
const ALL_SIDES: Sides<boolean> = {
	top: true,
	right: true,
	bottom: true,
	left: true,
};
const DEFAULT_PADDING = { x: 4, y: 2 };

/** The table's sides for a cell, with the ones its `border` sets. */
const withBorder = (
	sides: Sides<boolean>,
	border: Partial<Sides<boolean>>,
): Sides<boolean> => ({
	top: border.top ?? sides.top,
	right: border.right ?? sides.right,
	bottom: border.bottom ?? sides.bottom,
	left: border.left ?? sides.left,
});

/** A table's layout: its columns resolved, its rows laid out one at a time as they are placed. */
export class TableLayout {
	readonly #styles: Styles;
	readonly #cascade: Cascade;
	readonly #style: Style;
	readonly #spec: Table["table"];
	readonly #x: number;
	readonly #widths: number[];
	readonly #rowStyle: RowStyle;

	constructor(
		styles: Styles,
		cascade: Cascade,
		table: Table,
		x: number,
		width: number,
	) {
		this.#styles = styles;
		this.#cascade = styles.cascade(cascade, table);
		this.#style = styles.style(this.#cascade);
		this.#spec = table.table;
		this.#x = x;
		const padding = this.#spec.padding ?? DEFAULT_PADDING;
		this.#rowStyle = {
			padding:
				typeof padding === "number" ? { x: padding, y: padding } : padding,
			stroke: stroke(
				this.#spec.borderWidth ?? 0.5,
				styles.color(this.#spec.borderColor ?? "#000"),
			),
		};
		const header = this.#spec.header ?? [];
		checkSpans(header, this.#spec.rows, this.#spec.widths.length);
		this.#widths = columnWidths(
			styles,
			this.#cascade,
			this.#spec.widths,
			[...header, ...this.#spec.rows],
			this.#rowStyle.padding.x,
			width,
		);
	}

	get header(): LaidRow[] {
		return (this.#spec.header ?? []).map((row) => this.#row(row, false));
	}

	/** Every row's height, the header's included: for a table kept together. */
	height(): number {
		const rows = this.#spec.rows;
		return (
			heightOf(this.header) +
			rows.reduce(
				(sum, row, i) => sum + this.#row(row, i === rows.length - 1).height,
				0,
			)
		);
	}

	/** The header's height and the first row's: what must fit for the table to start on a page. */
	startHeight(): number {
		const first = this.#spec.rows[0];
		return (
			heightOf(this.header) +
			(first ? this.#row(first, this.#spec.rows.length === 1).height : 0)
		);
	}

	async place(flow: Flow): Promise<void> {
		const header = this.header;
		const headerHeight = heightOf(header);
		const draw = (row: LaidRow) => {
			drawRow(flow.page, row, flow.y, this.#rowStyle);
			flow.y += row.height;
		};
		// A first row taller than a page starts at the top of one, and splits there.
		await flow.fit(Math.min(this.startHeight(), flow.pageHeight));
		if (headerHeight > flow.room) throw noRoomForRows(headerHeight, flow);
		header.forEach(draw);
		const rows = this.#spec.rows;
		for (let i = 0; i < rows.length; i++) {
			let row = this.#row(rows[i] ?? [], i === rows.length - 1);
			while (row.height > flow.room) {
				const fitsAPage = row.height <= flow.pageHeight - headerHeight;
				const [part, rest] = fitsAPage
					? [undefined, row]
					: splitRow(row, flow.room, this.#rowStyle);
				if (part) draw(part);
				else if (flow.y === flow.area.top + headerHeight)
					throw noRoomForRows(headerHeight, flow);
				await flow.newPage();
				header.forEach(draw);
				row = rest;
			}
			draw(row);
		}
	}

	/** A row's cells laid out: lines broken to their columns, sides from the borders and the cell. */
	#row(row: readonly Cell[], last: boolean): LaidRow {
		const borders = this.#spec.borders;
		const sides =
			borders === "grid"
				? ALL_SIDES
				: borders === "rows"
					? { ...NO_SIDES, bottom: !last }
					: NO_SIDES;
		const { padding } = this.#rowStyle;
		const cells: LaidCell[] = [];
		let column = 0;
		let x = this.#x;
		let height = 0;
		let uniform = true;
		for (const cell of row) {
			const own = typeof cell === "string" ? undefined : cell;
			const span = spanOf(cell);
			let width = 0;
			for (let k = 0; k < span; k++) width += this.#widths[column + k] ?? 0;
			const lines = this.#lines(cell, width - 2 * padding.x);
			if (own?.border) uniform = false;
			cells.push({
				x,
				width,
				lines,
				align: own?.align,
				fill:
					own?.fill === undefined ? undefined : this.#styles.color(own.fill),
				sides: own?.border ? withBorder(sides, own.border) : sides,
			});
			height = Math.max(height, heightOf(lines) + 2 * padding.y);
			column += span;
			x += width;
		}
		return { cells, height, uniform };
	}

	#lines(cell: Cell, width: number): Line[] {
		// A cell that sets no style of its own, the common case, uses the table's, resolved once.
		const plain =
			typeof cell === "string"
				? cell
				: typeof cell.text === "string" && !setsStyle(cell)
					? cell.text
					: undefined;
		if (plain !== undefined)
			return breakLines(
				[{ text: plain.normalize("NFC"), style: this.#style, link: undefined }],
				width,
			);
		const { text, ...style } = cellParts(cell);
		return breakLines(
			runsOf(
				this.#styles,
				this.#styles.cascade(this.#cascade, style),
				text,
				undefined,
			),
			width,
		);
	}
}

function noRoomForRows(headerHeight: number, flow: Flow): PdfError {
	return pageTooSmall(
		`A table's header is ${Math.ceil(headerHeight)} points tall, and leaves too little of the page's ${Math.floor(flow.pageHeight)}-point body for a line of its rows. Make the header shorter, or the page larger or its margins narrower.`,
	);
}
