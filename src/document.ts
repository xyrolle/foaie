// The definition of a document: plain data that `render()` lays out and writes.

import type { Font } from "./font/font.ts";
import type { Image } from "./image/image.ts";

/** A colour as `#rgb` or `#rrggbb`. */
export type Color = `#${string}`;

export type Align = "left" | "center" | "right";

export type Sides<T> = { top: T; right: T; bottom: T; left: T };

/** A style a block, a cell or a span may set; what it leaves out it inherits. */
export type TextStyle = {
	/** A family named in the document's `fonts`. */
	font?: string;
	/** The size in points. */
	size?: number;
	bold?: boolean;
	italic?: boolean;
	color?: Color;
	/** A multiple of the face's own line spacing; 1 by default. */
	lineHeight?: number;
};

/** Space above and below a block, in points. */
export type Spacing = { spaceBefore?: number; spaceAfter?: number };

/** A run of text with its own style, or a link. */
export type Span = string | (TextStyle & { text: string; link?: string });

export type Paragraph = Spacing &
	TextStyle & {
		text: string | readonly Span[];
		align?: Align;
		/** A URL the whole paragraph links to. */
		link?: string;
		/** Keeps the paragraph on the page with the first line or row after it: for headings. */
		keepWithNext?: boolean;
	};

export type Cell =
	| string
	| (TextStyle & {
			text: string | readonly Span[];
			align?: Align;
			fill?: Color;
			/** How many columns the cell spans; 1 by default. */
			colSpan?: number;
			/** Sides drawn or left out, whatever the table's borders say. */
			border?: Partial<Sides<boolean>>;
	  });

/** A column's width: points (padding included), `auto` (its widest line) or `*` (a share of the rest). */
export type Width = number | "auto" | "*";

export type Table = Spacing &
	TextStyle & {
		table: {
			widths: readonly Width[];
			/** Rows repeated at the top of every page the table continues on. */
			header?: readonly (readonly Cell[])[];
			rows: readonly (readonly Cell[])[];
			/** `grid` draws every side, `rows` a rule between rows; `none` by default. */
			borders?: "grid" | "rows" | "none";
			borderColor?: Color;
			/** In points; 0.5 by default. */
			borderWidth?: number;
			/** Inside each cell, in points: one number for both, or each; 4 across and 2 down by default. */
			padding?: number | { x: number; y: number };
		};
		/** Moves the whole table to the next page when it fits on one. */
		keepTogether?: boolean;
	};

export type Picture = Spacing & {
	image: Image;
	/** In points; with only one of width and height, the other keeps the image's proportions. */
	width?: number;
	height?: number;
	align?: Align;
};

export type Stack = Spacing & {
	stack: readonly Block[];
	/** Moves the whole stack to the next page when it fits on one. */
	keepTogether?: boolean;
};

export type Block = Paragraph | Table | Picture | Stack;

export type PageSize =
	| "A3"
	| "A4"
	| "A5"
	| "Letter"
	| "Legal"
	| readonly [width: number, height: number];

/** A family's faces: `bold` and `italic` in a style pick one. */
export type Family = {
	normal: Font;
	bold?: Font;
	italic?: Font;
	boldItalic?: Font;
};

/** Where a page sits in the document, for its header and footer. */
export type PageNumber = { page: number; pages: number };

export type Document = {
	page: { size: PageSize; landscape?: boolean; margin: number | Sides<number> };
	fonts: Readonly<Record<string, Family>>;
	/** The document's default style; it must name a family. */
	style: TextStyle & { font: string };
	content: readonly Block[];
	/** Blocks laid out in the top margin of every page. */
	header?: (at: PageNumber) => readonly Block[];
	/** Blocks laid out in the bottom margin of every page. */
	footer?: (at: PageNumber) => readonly Block[];
	/** Text across every page, rotated and translucent. */
	watermark?: TextStyle & { text: string; opacity?: number; angle?: number };
	info?: {
		title?: string;
		author?: string;
		subject?: string;
		keywords?: string;
		creator?: string;
		created?: Date;
	};
	/** The document's language, as a BCP 47 tag such as "en" or "ro-MD". */
	lang?: string;
};
