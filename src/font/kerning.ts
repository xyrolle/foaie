// Pair kerning: how much closer or further apart two glyphs sit, in font units.
// From GPOS pair adjustment (lookup type 2) under the "kern" feature, else from the legacy kern table.
// https://learn.microsoft.com/typography/opentype/spec/gpos#lookup-type-2-pair-adjustment-positioning-subtable

import { type TableRange, tagAt } from "./sfnt.ts";

/** Kerning between a left and a right glyph; undefined when a subtable doesn't cover the pair. */
type PairLookup = (left: number, right: number) => number | undefined;

export type Kerning = (left: number, right: number) => number;

const NONE: Kerning = () => 0;
const PAIR_ADJUSTMENT = 2;
const EXTENSION = 9;

/** The font's kerning, read lazily: a pair is looked up once, then remembered. */
export function readKerning(
	view: DataView,
	tables: Map<string, TableRange>,
): Kerning {
	const gpos = tables.get("GPOS");
	const kern = tables.get("kern");
	const lookups = gpos
		? gposPairLookups(view, gpos.offset)
		: kern
			? [kernTable(view, kern.offset)]
			: [];
	if (lookups.length === 0) return NONE;
	const known = new Map<number, number>();
	return (left, right) => {
		const key = left * 0x10000 + right;
		let value = known.get(key);
		if (value === undefined) {
			value = 0;
			for (const lookup of lookups) {
				const found = lookup(left, right);
				if (found !== undefined) {
					value = found;
					break;
				}
			}
			known.set(key, value);
		}
		return value;
	};
}

function gposPairLookups(view: DataView, base: number): PairLookup[] {
	const features = base + view.getUint16(base + 6);
	const lookupList = base + view.getUint16(base + 8);
	const indices = new Set<number>();
	for (let i = 0, count = view.getUint16(features); i < count; i++) {
		const record = features + 2 + 6 * i;
		if (tagAt(view, record) !== "kern") continue;
		const feature = features + view.getUint16(record + 4);
		for (let k = 0, n = view.getUint16(feature + 2); k < n; k++)
			indices.add(view.getUint16(feature + 4 + 2 * k));
	}
	const pairs: PairLookup[] = [];
	for (const index of [...indices].sort((a, b) => a - b)) {
		const lookup = lookupList + view.getUint16(lookupList + 2 + 2 * index);
		const type = view.getUint16(lookup);
		for (let s = 0, n = view.getUint16(lookup + 4); s < n; s++) {
			let subtable = lookup + view.getUint16(lookup + 6 + 2 * s);
			if (type === EXTENSION) {
				if (view.getUint16(subtable + 2) !== PAIR_ADJUSTMENT) continue;
				subtable += view.getUint32(subtable + 4);
			} else if (type !== PAIR_ADJUSTMENT) continue;
			const format = view.getUint16(subtable);
			if (format === 1) pairs.push(pairSets(view, subtable));
			else if (format === 2) pairs.push(classPairs(view, subtable));
		}
	}
	return pairs;
}

/** Format 1: for each covered left glyph, a sorted list of right glyphs and their values. */
function pairSets(view: DataView, at: number): PairLookup {
	const covered = coverage(view, at + view.getUint16(at + 2));
	const leftFormat = view.getUint16(at + 4);
	const record = 2 + valueSize(leftFormat) + valueSize(view.getUint16(at + 6));
	return (left, right) => {
		const index = covered.get(left);
		if (index === undefined) return undefined;
		const set = at + view.getUint16(at + 10 + 2 * index);
		let low = 0;
		let high = view.getUint16(set) - 1;
		while (low <= high) {
			const middle = (low + high) >> 1;
			const pair = set + 2 + middle * record;
			const glyph = view.getUint16(pair);
			if (glyph === right) return xAdvance(view, pair + 2, leftFormat);
			if (glyph < right) low = middle + 1;
			else high = middle - 1;
		}
		return undefined;
	};
}

/** Format 2: a value for each pair of glyph classes. */
function classPairs(view: DataView, at: number): PairLookup {
	const covered = coverage(view, at + view.getUint16(at + 2));
	const leftFormat = view.getUint16(at + 4);
	const record = valueSize(leftFormat) + valueSize(view.getUint16(at + 6));
	const leftClasses = classes(view, at + view.getUint16(at + 8));
	const rightClasses = classes(view, at + view.getUint16(at + 10));
	const rightCount = view.getUint16(at + 14);
	return (left, right) => {
		if (!covered.has(left)) return undefined;
		const row = leftClasses.get(left) ?? 0;
		const column = rightClasses.get(right) ?? 0;
		return xAdvance(
			view,
			at + 16 + (row * rightCount + column) * record,
			leftFormat,
		);
	};
}

/** The legacy kern table's format 0 subtable: a sorted list of glyph pairs. */
function kernTable(view: DataView, at: number): PairLookup {
	const subtable = at + 4;
	const pairs = new Map<number, number>();
	if (view.getUint16(at) === 0 && view.getUint16(subtable + 4) >> 8 === 0) {
		for (let i = 0, n = view.getUint16(subtable + 6); i < n; i++) {
			const pair = subtable + 14 + 6 * i;
			pairs.set(
				view.getUint16(pair) * 0x10000 + view.getUint16(pair + 2),
				view.getInt16(pair + 4),
			);
		}
	}
	return (left, right) => pairs.get(left * 0x10000 + right);
}

/** Glyph → its index in the coverage table. */
function coverage(view: DataView, at: number): Map<number, number> {
	const map = new Map<number, number>();
	const count = view.getUint16(at + 2);
	if (view.getUint16(at) === 1) {
		for (let i = 0; i < count; i++) map.set(view.getUint16(at + 4 + 2 * i), i);
		return map;
	}
	for (let i = 0; i < count; i++) {
		const range = at + 4 + 6 * i;
		const first = view.getUint16(range + 4);
		for (
			let glyph = view.getUint16(range), k = 0;
			glyph <= view.getUint16(range + 2);
			glyph++, k++
		)
			map.set(glyph, first + k);
	}
	return map;
}

/** Glyph → its class; glyphs not listed are class 0. */
function classes(view: DataView, at: number): Map<number, number> {
	const map = new Map<number, number>();
	if (view.getUint16(at) === 1) {
		const first = view.getUint16(at + 2);
		for (let i = 0, n = view.getUint16(at + 4); i < n; i++)
			map.set(first + i, view.getUint16(at + 6 + 2 * i));
		return map;
	}
	for (let i = 0, n = view.getUint16(at + 2); i < n; i++) {
		const range = at + 4 + 6 * i;
		for (
			let glyph = view.getUint16(range);
			glyph <= view.getUint16(range + 2);
			glyph++
		)
			map.set(glyph, view.getUint16(range + 4));
	}
	return map;
}

/** A value record's size: two bytes for each field its format's bits name. */
function valueSize(format: number): number {
	let fields = 0;
	for (let bits = format; bits; bits >>= 1) fields += bits & 1;
	return 2 * fields;
}

/** The record's horizontal advance adjustment (its third field), when the format has one. */
function xAdvance(view: DataView, at: number, format: number): number {
	const X_ADVANCE = 4;
	if (!(format & X_ADVANCE)) return 0;
	return view.getInt16(at + (format & 1 ? 2 : 0) + (format & 2 ? 2 : 0));
}
