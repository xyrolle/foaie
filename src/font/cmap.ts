// The character map: which glyph draws each Unicode code point.
// https://learn.microsoft.com/typography/opentype/spec/cmap

/** The font's Unicode map, from its full-repertoire subtable (format 12) or its BMP one (format 4). */
export function readCmap(view: DataView, cmap: number): Map<number, number> {
	let bmp = 0;
	let full = 0;
	for (let i = 0, count = view.getUint16(cmap + 2); i < count; i++) {
		const record = cmap + 4 + 8 * i;
		const platform = view.getUint16(record);
		const encoding = view.getUint16(record + 2);
		const subtable = cmap + view.getUint32(record + 4);
		const unicode =
			platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
		if (!unicode) continue;
		const format = view.getUint16(subtable);
		if (format === 12) full = subtable;
		else if (format === 4) bmp = subtable;
	}
	if (full) return readFormat12(view, full);
	if (bmp) return readFormat4(view, bmp);
	return new Map();
}

/** Segmented coverage: groups of consecutive code points mapped to consecutive glyphs. */
function readFormat12(view: DataView, at: number): Map<number, number> {
	const map = new Map<number, number>();
	for (let i = 0, groups = view.getUint32(at + 12); i < groups; i++) {
		const group = at + 16 + 12 * i;
		const start = view.getUint32(group);
		const end = view.getUint32(group + 4);
		const first = view.getUint32(group + 8);
		for (let code = start; code <= end; code++)
			map.set(code, first + code - start);
	}
	return map;
}

/** Segment mapping to delta values, the BMP's classic table. */
function readFormat4(view: DataView, at: number): Map<number, number> {
	const map = new Map<number, number>();
	const segments = view.getUint16(at + 6) / 2;
	const ends = at + 14;
	const starts = ends + 2 * segments + 2;
	const deltas = starts + 2 * segments;
	const rangeOffsets = deltas + 2 * segments;
	for (let s = 0; s < segments; s++) {
		const start = view.getUint16(starts + 2 * s);
		const end = view.getUint16(ends + 2 * s);
		const delta = view.getUint16(deltas + 2 * s);
		const rangeOffset = view.getUint16(rangeOffsets + 2 * s);
		for (let code = start; code <= end && code !== 0xffff; code++) {
			// With a range offset, the glyph comes from the glyph array, where 0 means "none".
			const indexed = rangeOffset
				? view.getUint16(
						rangeOffsets + 2 * s + rangeOffset + 2 * (code - start),
					)
				: code;
			if (rangeOffset && indexed === 0) continue;
			const glyph = (indexed + delta) & 0xffff;
			if (glyph) map.set(code, glyph);
		}
	}
	return map;
}
