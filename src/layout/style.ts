// Styles as they cascade, from the document to the block, the cell and the span, and the face
// each one draws with.

import type { Family, TextStyle } from "../document.ts";
import { finite, PdfError } from "../errors.ts";
import { type Font, trueTypeOf } from "../font/font.ts";
import { GlyphSubset } from "../font/subset.ts";
import type { TrueType } from "../font/truetype.ts";

/** Everything a style can set, resolved: what a block, cell or span inherits. */
export type Cascade = {
	font: string;
	size: number;
	bold: boolean;
	italic: boolean;
	color: string;
	lineHeight: number;
};

/** One face as this document uses it: the glyphs it draws and its name in the page's resources. */
export type FaceUse = { face: TrueType; subset: GlyphSubset; resource: string };

/** A cascade made drawable: its face, and its colour as PDF operands. */
export type Style = {
	use: FaceUse;
	/** The operator that selects the face at the size: "/F1 10 Tf". */
	font: string;
	size: number;
	color: string;
	/** Points from a line's top to its baseline, and from its top to the next line's top. */
	ascent: number;
	lineHeight: number;
};

const BLACK = "#000";

export class Styles {
	readonly uses: FaceUse[] = [];
	readonly #fonts: Readonly<Record<string, Family>>;
	readonly #uses = new Map<TrueType, FaceUse>();
	readonly #styles = new Map<string, Style>();

	constructor(fonts: Readonly<Record<string, Family>>) {
		this.#fonts = fonts;
	}

	/** The cascade below `parent` once `own` has set what it sets. */
	cascade(parent: Cascade, own: TextStyle): Cascade {
		return {
			font: own.font ?? parent.font,
			size: own.size ?? parent.size,
			bold: own.bold ?? parent.bold,
			italic: own.italic ?? parent.italic,
			color: own.color ?? parent.color,
			lineHeight: own.lineHeight ?? parent.lineHeight,
		};
	}

	/** The drawable style of a cascade, made once per document and reused. */
	style(cascade: Cascade): Style {
		const key = `${cascade.font}\n${cascade.bold}\n${cascade.italic}\n${cascade.size}\n${cascade.color}\n${cascade.lineHeight}`;
		let style = this.#styles.get(key);
		if (!style) {
			const use = this.#use(this.#face(cascade));
			const { face } = use;
			const scale = finite(cascade.size, "A style's size") / face.unitsPerEm;
			style = {
				use,
				font: `/${use.resource} ${decimal(cascade.size)} Tf`,
				size: cascade.size,
				color: rgb(cascade.color),
				ascent: face.ascender * scale,
				lineHeight:
					(face.ascender - face.descender + face.lineGap) *
					scale *
					finite(cascade.lineHeight, "A style's lineHeight"),
			};
			this.#styles.set(key, style);
		}
		return style;
	}

	#face({ font, bold, italic }: Cascade): TrueType {
		const family = this.#fonts[font];
		if (!family)
			throw new PdfError(
				"face-missing",
				`No family "${font}" in the document's fonts. Add it to \`fonts\`, or fix the style's \`font\`.`,
			);
		const slot = bold
			? italic
				? "boldItalic"
				: "bold"
			: italic
				? "italic"
				: "normal";
		const handle: Font | undefined = family[slot];
		if (!handle)
			throw new PdfError(
				"face-missing",
				`The family "${font}" has no ${slot} face. Add \`fonts.${font}.${slot}\`, made with font().`,
			);
		const face = trueTypeOf(handle);
		if (!face)
			throw new PdfError(
				"face-missing",
				`\`fonts.${font}.${slot}\` wasn't made by font(). Parse the font's bytes with font().`,
			);
		return face;
	}

	#use(face: TrueType): FaceUse {
		let use = this.#uses.get(face);
		if (!use) {
			use = {
				face,
				subset: new GlyphSubset(face),
				resource: `F${this.#uses.size + 1}`,
			};
			this.#uses.set(face, use);
			this.uses.push(use);
		}
		return use;
	}
}

export const defaultCascade = (
	style: TextStyle & { font: string },
): Cascade => ({
	font: style.font,
	size: style.size ?? 10,
	bold: style.bold ?? false,
	italic: style.italic ?? false,
	color: style.color ?? BLACK,
	lineHeight: style.lineHeight ?? 1,
});

const colors = new Map<string, string>();

/** `#rgb` or `#rrggbb` as the three numbers PDF's colour operators take. */
export function rgb(hex: string): string {
	let operands = colors.get(hex);
	if (operands === undefined) {
		const digits = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex)?.[1];
		if (!digits)
			throw new PdfError(
				"color-invalid",
				`"${hex}" isn't a colour foaie reads. Write it as #rgb or #rrggbb.`,
			);
		const full =
			digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits;
		const value = Number.parseInt(full, 16);
		operands = [value >> 16, (value >> 8) & 0xff, value & 0xff]
			.map((channel) => decimal(channel / 255))
			.join(" ");
		colors.set(hex, operands);
	}
	return operands;
}

/** A number as a PDF operand: at most two decimals (a hundredth of a point). */
export function decimal(value: number): string {
	return String(
		Math.round(finite(value, "A number in the document") * 100) / 100,
	);
}
