// The glyphs one document draws from one face, renumbered in the order it first draws them,
// and the smaller font program that holds only those.

import { writeSfnt } from "./sfnt.ts";
import type { TrueType } from "./truetype.ts";

/** The tables a PDF reader needs from an embedded TrueType program (ISO 32000-1, 9.9). */
const HINTING_TABLES = ["cvt ", "fpgm", "prep"];

export class GlyphSubset {
	readonly face: TrueType;
	/** Each glyph drawn, in the subset's order; the subset's glyph 0 is the face's .notdef. */
	readonly glyphs: number[] = [0];
	/** The code point each subset glyph draws, for the ToUnicode map; none for a composite's part. */
	readonly codePoints: (number | undefined)[] = [undefined];
	readonly #ids = new Map<number, number>([[0, 0]]);

	constructor(face: TrueType) {
		this.face = face;
	}

	/** The subset's number for a face glyph, adding it on first use. */
	use(glyph: number, codePoint: number | undefined): number {
		let id = this.#ids.get(glyph);
		if (id === undefined) {
			id = this.glyphs.length;
			this.#ids.set(glyph, id);
			this.glyphs.push(glyph);
			this.codePoints.push(codePoint);
		}
		return id;
	}

	/** The subset as a TrueType program. Composite glyphs bring their parts into the subset. */
	program(): Uint8Array<ArrayBuffer> {
		const face = this.face;
		const outlines: Uint8Array[] = [];
		for (let id = 0; id < this.glyphs.length; id++) {
			const outline = face.outline(this.glyphs[id] ?? 0);
			outlines.push(
				isComposite(outline) ? this.#renumberParts(outline) : outline,
			);
		}
		const count = this.glyphs.length;
		const loca = new DataView(new ArrayBuffer(4 * (count + 1)));
		let size = 0;
		outlines.forEach((outline, id) => {
			loca.setUint32(4 * id, size);
			size += (outline.length + 3) & ~3;
		});
		loca.setUint32(4 * count, size);
		const glyf = new Uint8Array(size);
		outlines.forEach((outline, id) => {
			glyf.set(outline, loca.getUint32(4 * id));
		});

		const hmtx = new DataView(new ArrayBuffer(4 * count));
		this.glyphs.forEach((glyph, id) => {
			hmtx.setUint16(4 * id, face.advances[glyph] ?? 0);
			hmtx.setInt16(4 * id + 2, face.leftSideBearing(glyph));
		});
		const head = copy(face, "head");
		viewOf(head).setUint32(8, 0); // checksum adjustment: not used by PDF readers
		viewOf(head).setInt16(50, 1); // long loca offsets
		const hhea = copy(face, "hhea");
		viewOf(hhea).setUint16(34, count);
		const maxp = copy(face, "maxp");
		viewOf(maxp).setUint16(4, count);

		const tables = new Map<string, Uint8Array>([
			["glyf", glyf],
			["head", head],
			["hhea", hhea],
			["hmtx", new Uint8Array(hmtx.buffer)],
			["loca", new Uint8Array(loca.buffer)],
			["maxp", maxp],
		]);
		for (const tag of HINTING_TABLES) {
			const table = face.table(tag);
			if (table) tables.set(tag, table);
		}
		return writeSfnt(tables);
	}

	/** A composite glyph names its parts by glyph number: a copy that names them by subset number. */
	#renumberParts(outline: Uint8Array): Uint8Array {
		const ARGS_ARE_WORDS = 0x0001;
		const HAS_SCALE = 0x0008;
		const MORE_COMPONENTS = 0x0020;
		const HAS_X_AND_Y_SCALE = 0x0040;
		const HAS_TWO_BY_TWO = 0x0080;
		const copied = outline.slice();
		const view = viewOf(copied);
		let at = 10; // past the glyph header
		let flags: number;
		do {
			flags = view.getUint16(at);
			view.setUint16(at + 2, this.use(view.getUint16(at + 2), undefined));
			at += 4 + (flags & ARGS_ARE_WORDS ? 4 : 2);
			if (flags & HAS_SCALE) at += 2;
			else if (flags & HAS_X_AND_Y_SCALE) at += 4;
			else if (flags & HAS_TWO_BY_TWO) at += 8;
		} while (flags & MORE_COMPONENTS);
		return copied;
	}
}

const isComposite = (outline: Uint8Array) =>
	outline.length > 0 &&
	new DataView(outline.buffer, outline.byteOffset).getInt16(0) < 0;

const viewOf = (bytes: Uint8Array) =>
	new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

function copy(face: TrueType, tag: string): Uint8Array {
	return (face.table(tag) ?? new Uint8Array()).slice();
}
