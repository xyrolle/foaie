import { PdfError } from "../errors.ts";
import { TrueType, UnsupportedFont } from "./truetype.ts";

/** A parsed font face, made by `font()` and reused by every render. */
export interface Font {
	/** The face's PostScript name. */
	readonly name: string;
}

const parsed = new WeakMap<Font, TrueType>();

/**
 * Parses a TrueType font (a `.ttf` file) once, for every render that uses it.
 * Throws `font-format` for OpenType CFF, WOFF, WOFF2 and collections, and `font-invalid` for broken bytes.
 */
export function font(data: Uint8Array | ArrayBuffer): Font {
	// A plain view of the bytes: a Node Buffer's slice() would share its memory instead of copying.
	const bytes =
		data instanceof Uint8Array
			? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			: new Uint8Array(data);
	let trueType: TrueType;
	try {
		trueType = new TrueType(bytes);
	} catch (error) {
		if (error instanceof UnsupportedFont)
			throw new PdfError(
				"font-format",
				`foaie embeds TrueType fonts (.ttf), and this is ${error.message}. Use the family's TTF build.`,
			);
		// A truncated or corrupt file runs a read past its end.
		if (error instanceof RangeError)
			throw new PdfError(
				"font-invalid",
				"The font's bytes are broken: a table points outside the file.",
				{ cause: error },
			);
		throw error;
	}
	const handle: Font = Object.freeze({ name: trueType.name });
	parsed.set(handle, trueType);
	return handle;
}

/** The parsed face behind a handle `font()` returned. */
export function trueTypeOf(handle: Font): TrueType | undefined {
	return parsed.get(handle);
}
