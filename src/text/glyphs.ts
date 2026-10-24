// Text as glyphs: how wide it sets in a face, and how a page's content stream shows it.

import type { TrueType } from "../font/truetype.ts";
import type { FaceUse } from "../layout/style.ts";
import { decimal } from "../layout/style.ts";

const HEX = Array.from({ length: 256 }, (_, byte) =>
	byte.toString(16).padStart(2, "0"),
);
/** Code points above this take two UTF-16 units. */
const BMP_END = 0xffff;

/** The width of `text` in the face's units, kerning included. */
export function advance(face: TrueType, text: string): number {
	let width = 0;
	let previous = -1;
	for (let i = 0; i < text.length; ) {
		const codePoint = text.codePointAt(i) ?? 0;
		i += codePoint > BMP_END ? 2 : 1;
		const glyph = face.glyph(codePoint);
		width += face.advances[glyph] ?? 0;
		if (previous >= 0) width += face.kerning(previous, glyph);
		previous = glyph;
	}
	return width;
}

/** The width of `text` in points at `size`. */
export function widthOf(face: TrueType, text: string, size: number): number {
	return (advance(face, text) * size) / face.unitsPerEm;
}

/** How much of `text`, in UTF-16 units, fits `width` points at `size`: always its first character. */
export function fittingLength(
	face: TrueType,
	text: string,
	size: number,
	width: number,
): number {
	const room = (width * face.unitsPerEm) / size;
	let used = 0;
	let previous = -1;
	for (let i = 0; i < text.length; ) {
		const codePoint = text.codePointAt(i) ?? 0;
		const glyph = face.glyph(codePoint);
		used += face.advances[glyph] ?? 0;
		if (previous >= 0) used += face.kerning(previous, glyph);
		if (used > room && i > 0) return i;
		i += codePoint > BMP_END ? 2 : 1;
		previous = glyph;
	}
	return text.length;
}

/**
 * `text` as a TJ operand: two-byte subset glyph numbers in hex, with kerning between them as
 * thousandths of the text size (ISO 32000-1, 9.4.3).
 */
export function show(use: FaceUse, text: string): string {
	const { face, subset } = use;
	const scale = 1000 / face.unitsPerEm;
	let operand = "[<";
	let previous = -1;
	for (let i = 0; i < text.length; ) {
		const codePoint = text.codePointAt(i) ?? 0;
		i += codePoint > BMP_END ? 2 : 1;
		const glyph = face.glyph(codePoint);
		if (previous >= 0) {
			const kerning = face.kerning(previous, glyph);
			if (kerning) operand += `>${decimal(-kerning * scale)}<`;
		}
		const id = subset.use(glyph, codePoint);
		operand += (HEX[id >> 8] ?? "00") + (HEX[id & 0xff] ?? "00");
		previous = glyph;
	}
	return `${operand}>]`;
}
