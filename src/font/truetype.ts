// A TrueType font, read once: its metrics, character map, kerning and glyph outlines.
// https://learn.microsoft.com/typography/opentype/spec/

import { readCmap } from "./cmap.ts";
import { type Kerning, readKerning } from "./kerning.ts";
import { readDirectory, type TableRange } from "./sfnt.ts";

/** Why a font's bytes can't be embedded: the format, or a broken file. */
export class UnsupportedFont extends Error {}

export class TrueType {
	readonly bytes: Uint8Array;
	readonly view: DataView;
	readonly tables: Map<string, TableRange>;
	readonly name: string;
	readonly unitsPerEm: number;
	readonly ascender: number;
	readonly descender: number;
	readonly lineGap: number;
	readonly capHeight: number;
	readonly italicAngle: number;
	readonly fixedPitch: boolean;
	readonly bbox: readonly [number, number, number, number];
	readonly glyphCount: number;
	readonly metricCount: number;
	readonly advances: Uint16Array;
	readonly kerning: Kerning;
	readonly #cmap: Map<number, number>;
	readonly #longLoca: boolean;

	constructor(bytes: Uint8Array) {
		this.bytes = bytes;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		const directory = readDirectory(this.view);
		if (typeof directory === "string") throw new UnsupportedFont(directory);
		this.tables = directory;
		if (!this.tables.has("glyf") || !this.tables.has("loca"))
			throw new UnsupportedFont("a font without TrueType outlines");
		const view = this.view;
		const head = this.offset("head");
		this.unitsPerEm = view.getUint16(head + 18);
		this.bbox = [
			view.getInt16(head + 36),
			view.getInt16(head + 38),
			view.getInt16(head + 40),
			view.getInt16(head + 42),
		];
		this.#longLoca = view.getInt16(head + 50) === 1;
		const hhea = this.offset("hhea");
		this.ascender = view.getInt16(hhea + 4);
		this.descender = view.getInt16(hhea + 6);
		this.lineGap = view.getInt16(hhea + 8);
		this.metricCount = view.getUint16(hhea + 34);
		this.glyphCount = view.getUint16(this.offset("maxp") + 4);
		const os2 = this.tables.get("OS/2");
		const OS2_CAP_HEIGHT_VERSION = 2;
		this.capHeight =
			os2 && view.getUint16(os2.offset) >= OS2_CAP_HEIGHT_VERSION
				? view.getInt16(os2.offset + 88)
				: this.ascender;
		// The post and cmap tables are optional here: an embedded subset carries neither.
		const post = this.tables.get("post");
		this.italicAngle = post ? view.getInt32(post.offset + 4) / 0x10000 : 0;
		this.fixedPitch = post ? view.getUint32(post.offset + 12) !== 0 : false;
		this.name = postScriptName(view, this.tables.get("name")) ?? "Font";
		const cmap = this.tables.get("cmap");
		this.#cmap = cmap ? readCmap(view, cmap.offset) : new Map();
		this.advances = new Uint16Array(this.glyphCount);
		const hmtx = this.offset("hmtx");
		const lastMetric = this.metricCount - 1;
		for (let glyph = 0; glyph < this.glyphCount; glyph++)
			this.advances[glyph] = view.getUint16(
				hmtx + 4 * Math.min(glyph, lastMetric),
			);
		this.kerning = readKerning(view, this.tables);
	}

	/** The glyph that draws a code point; 0, the .notdef box, when the font has none. */
	glyph(codePoint: number): number {
		return this.#cmap.get(codePoint) ?? 0;
	}

	/** A glyph's left side bearing, which its horizontal metrics keep beside its advance. */
	leftSideBearing(glyph: number): number {
		const hmtx = this.offset("hmtx");
		return glyph < this.metricCount
			? this.view.getInt16(hmtx + 4 * glyph + 2)
			: this.view.getInt16(
					hmtx + 4 * this.metricCount + 2 * (glyph - this.metricCount),
				);
	}

	/** A glyph's outline, as the glyf table stores it; empty for a glyph that draws nothing. */
	outline(glyph: number): Uint8Array {
		const loca = this.offset("loca");
		const glyf = this.offset("glyf");
		const [start, end] = this.#longLoca
			? [
					this.view.getUint32(loca + 4 * glyph),
					this.view.getUint32(loca + 4 * glyph + 4),
				]
			: [
					2 * this.view.getUint16(loca + 2 * glyph),
					2 * this.view.getUint16(loca + 2 * glyph + 2),
				];
		return this.bytes.subarray(glyf + start, glyf + end);
	}

	/** A table's bytes, if the font has it. */
	table(tag: string): Uint8Array | undefined {
		const range = this.tables.get(tag);
		return (
			range && this.bytes.subarray(range.offset, range.offset + range.length)
		);
	}

	offset(tag: string): number {
		const range = this.tables.get(tag);
		if (!range)
			throw new UnsupportedFont(`a font without its required ${tag} table`);
		return range.offset;
	}
}

/** The PostScript name (name ID 6), the font's name in a PDF. */
function postScriptName(
	view: DataView,
	table: TableRange | undefined,
): string | undefined {
	if (!table) return undefined;
	const POSTSCRIPT_NAME = 6;
	const count = view.getUint16(table.offset + 2);
	const strings = table.offset + view.getUint16(table.offset + 4);
	for (let i = 0; i < count; i++) {
		const record = table.offset + 6 + 12 * i;
		if (view.getUint16(record + 6) !== POSTSCRIPT_NAME) continue;
		const wide = view.getUint16(record) !== 1; // Unicode and Windows store UTF-16, Macintosh one byte
		const length = view.getUint16(record + 8);
		const at = strings + view.getUint16(record + 10);
		let name = "";
		for (let k = 0; k < length; k += wide ? 2 : 1)
			name += String.fromCharCode(
				wide ? view.getUint16(at + k) : view.getUint8(at + k),
			);
		// A PDF name allows these printable ASCII characters; anything else is dropped.
		return name.replace(/[^!-~]|[()<>[\]{}/%#]/g, "");
	}
	return undefined;
}
