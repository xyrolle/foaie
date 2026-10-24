// One page's drawing, in top-left coordinates, written as PDF content operators
// (ISO 32000-1, 8 and 9) in the page's bottom-left coordinates.

import { show } from "../text/glyphs.ts";
import type { Line } from "../text/lines.ts";
import type { FaceUse, Style } from "./style.ts";
import { decimal as d } from "./style.ts";

const BLACK = "0 0 0";

/** The operators that set a line's width and colour (as its operands), made once for every line drawn alike. */
export const stroke = (width: number, color: string): string =>
	`${d(width)} w ${color} RG`;

/** A link's area on the page, in PDF coordinates: left, bottom, right, top. */
export type LinkArea = { url: string; rect: [number, number, number, number] };

export class PageContent {
	readonly width: number;
	readonly height: number;
	readonly fonts: Set<FaceUse> = new Set();
	/** The images drawn, by their names in the page's resources. */
	readonly images: Map<string, number> = new Map();
	readonly links: LinkArea[] = [];
	/** Whether the page draws through the translucent graphics state. */
	translucent = false;
	#operators: string[] = [];
	// The graphics state the stream has set so far, so an operator is written only when it changes.
	#font = "";
	#fill = BLACK;
	#stroke = "";

	constructor(width: number, height: number) {
		this.width = width;
		this.height = height;
	}

	/** Draws a line of text whose top is at `top`, starting at `x`. */
	text(line: Line, x: number, top: number): void {
		const baseline = this.height - top - line.ascent;
		let operators = "BT";
		/** Where the last piece started: Td moves from there (from the baseline's origin, for the first). */
		let origin: number | undefined;
		let left = x;
		for (const piece of line.pieces) {
			if (piece.text) {
				const { style } = piece;
				if (style.font !== this.#font) {
					this.#font = style.font;
					this.fonts.add(style.use);
					operators += ` ${style.font}`;
				}
				if (style.color !== this.#fill) {
					this.#fill = style.color;
					operators += ` ${style.color} rg`;
				}
				const move =
					origin === undefined
						? `${d(left)} ${d(baseline)}`
						: `${d(left - origin)} 0`;
				operators += ` ${move} Td ${show(style.use, piece.text)} TJ`;
				origin = left;
				if (piece.link)
					this.#link(piece.link, left, top, piece.width, line.height);
			}
			left += piece.width;
		}
		this.#operators.push(`${operators} ET`);
	}

	/** Fills a rectangle whose top-left corner is at `x`, `top`, in a colour's operands. */
	fill(
		x: number,
		top: number,
		width: number,
		height: number,
		color: string,
	): void {
		const set = color === this.#fill ? "" : `${color} rg `;
		this.#fill = color;
		this.#operators.push(
			`${set}${d(x)} ${d(this.height - top - height)} ${d(width)} ${d(height)} re f`,
		);
	}

	/** Strokes a straight line from one point to another, with a `stroke()`. */
	line(x1: number, y1: number, x2: number, y2: number, stroke: string): void {
		const set = stroke === this.#stroke ? "" : `${stroke} `;
		this.#stroke = stroke;
		this.#operators.push(
			`${set}${d(x1)} ${d(this.height - y1)} m ${d(x2)} ${d(this.height - y2)} l S`,
		);
	}

	/** Draws image XObject `name` in a box whose top-left corner is at `x`, `top`. */
	image(
		reference: number,
		name: string,
		x: number,
		top: number,
		width: number,
		height: number,
	): void {
		this.images.set(name, reference);
		this.#operators.push(
			`q ${d(width)} 0 0 ${d(height)} ${d(x)} ${d(this.height - top - height)} cm /${name} Do Q`,
		);
	}

	/** Text through the translucent graphics state /W1, placed by a text matrix: the watermark. */
	watermark(style: Style, text: string, matrix: string): void {
		this.fonts.add(style.use);
		this.translucent = true;
		this.#operators.push(
			`q /W1 gs ${style.color} rg BT ${style.font} ${matrix} Tm ${show(style.use, text)} TJ ET Q`,
		);
	}

	/** The page's content stream so far, as one string; the page's operators are released. */
	take(): string {
		const content = this.#operators.join("\n");
		this.#operators = [];
		// The next stream starts from the page's initial graphics state.
		this.#font = "";
		this.#fill = BLACK;
		this.#stroke = "";
		return content;
	}

	#link(
		url: string,
		x: number,
		top: number,
		width: number,
		height: number,
	): void {
		this.links.push({
			url,
			rect: [x, this.height - top - height, x + width, this.height - top],
		});
	}
}
