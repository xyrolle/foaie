// The container every TrueType font shares (OpenType's "sfnt"): a directory of tagged tables.
// https://learn.microsoft.com/typography/opentype/spec/otff

import { PdfError } from "../errors.ts";

/** A table's place in the font's bytes. */
export type TableRange = { offset: number; length: number };

const TRUE_TYPE = 0x00010000;
const APPLE_TRUE_TYPE = 0x74727565; // "true"

/** The signatures of the formats foaie can't embed, with what to use instead. */
const UNSUPPORTED: Record<number, string> = {
	1330926671: "OpenType with CFF outlines", // "OTTO"
	2001684038: "WOFF", // "wOFF"
	2001684018: "WOFF2", // "wOF2"
	1953784678: "a font collection", // "ttcf"
};

/** The font's tables by tag, or the reason its format can't be embedded. */
export function readDirectory(
	view: DataView,
): Map<string, TableRange> | string {
	const version = view.getUint32(0);
	if (version !== TRUE_TYPE && version !== APPLE_TRUE_TYPE)
		return UNSUPPORTED[version] ?? "not a font";
	const tables = new Map<string, TableRange>();
	for (let i = 0, count = view.getUint16(4); i < count; i++) {
		const record = 12 + 16 * i;
		const tag = tagAt(view, record);
		const range = {
			offset: view.getUint32(record + 8),
			length: view.getUint32(record + 12),
		};
		if (range.offset + range.length > view.byteLength)
			throw new PdfError(
				"font-invalid",
				`The font's bytes are broken: its ${tag.trim()} table runs past the end of the file. Check that the file isn't truncated.`,
			);
		tables.set(tag, range);
	}
	return tables;
}

export function tagAt(view: DataView, offset: number): string {
	return String.fromCharCode(
		view.getUint8(offset),
		view.getUint8(offset + 1),
		view.getUint8(offset + 2),
		view.getUint8(offset + 3),
	);
}

/** A font file made of `tables`, written in tag order with their checksums. */
export function writeSfnt(
	tables: Map<string, Uint8Array>,
): Uint8Array<ArrayBuffer> {
	const tags = [...tables.keys()].sort();
	const directorySize = 12 + 16 * tags.length;
	let size = directorySize;
	const offsets = tags.map((tag) => {
		const offset = size;
		size += padded(tables.get(tag)?.length ?? 0);
		return offset;
	});
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	const power = 2 ** Math.floor(Math.log2(tags.length));
	view.setUint32(0, TRUE_TYPE);
	view.setUint16(4, tags.length);
	view.setUint16(6, power * 16);
	view.setUint16(8, Math.log2(power));
	view.setUint16(10, (tags.length - power) * 16);
	tags.forEach((tag, i) => {
		const data = tables.get(tag) ?? new Uint8Array();
		const offset = offsets[i] ?? 0;
		out.set(data, offset);
		const record = 12 + 16 * i;
		for (let k = 0; k < 4; k++) view.setUint8(record + k, tag.charCodeAt(k));
		view.setUint32(record + 4, checksum(view, offset, data.length));
		view.setUint32(record + 8, offset);
		view.setUint32(record + 12, data.length);
	});
	return out;
}

const padded = (length: number) => (length + 3) & ~3;

/** The table's checksum: its bytes summed as big-endian 32-bit words, zero-padded. */
function checksum(view: DataView, offset: number, length: number): number {
	let sum = 0;
	for (let at = offset; at < offset + padded(length); at += 4)
		sum = (sum + view.getUint32(at)) >>> 0;
	return sum;
}
