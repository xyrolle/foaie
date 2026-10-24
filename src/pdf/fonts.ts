// An embedded face: a Type 0 font over a CIDFontType2, its subset program, its glyph widths and the
// ToUnicode map that turns its glyphs back into text (ISO 32000-1, 9.7 and 9.10).

import type { FaceUse } from "../layout/style.ts";
import { decimal } from "../layout/style.ts";
import type { PdfWriter } from "./writer.ts";

const FIXED_PITCH = 1;
/** Its glyphs fall outside the standard Latin set, as a Unicode face's do. */
const SYMBOLIC = 4;
const ITALIC = 64;

export async function writeFont(
	writer: PdfWriter,
	use: FaceUse,
	reference: number,
): Promise<void> {
	const { face, subset } = use;
	const scale = 1000 / face.unitsPerEm;
	const units = (value: number) => Math.round(value * scale);
	const [cidFont, descriptor, program, toUnicode] = [
		writer.reserve(),
		writer.reserve(),
		writer.reserve(),
		writer.reserve(),
	];
	const name = `${subsetTag(subset.glyphs)}+${face.name}`;
	const widths = subset.glyphs
		.map((glyph) => units(face.advances[glyph] ?? 0))
		.join(" ");
	const flags =
		(face.fixedPitch ? FIXED_PITCH : 0) |
		SYMBOLIC |
		(face.italicAngle ? ITALIC : 0);

	writer.object(
		reference,
		`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidFont} 0 R] /ToUnicode ${toUnicode} 0 R >>`,
	);
	writer.object(
		cidFont,
		`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descriptor} 0 R /CIDToGIDMap /Identity /W [0 [${widths}]] >>`,
	);
	writer.object(
		descriptor,
		`<< /Type /FontDescriptor /FontName /${name} /Flags ${flags} /FontBBox [${face.bbox.map(units).join(" ")}] /ItalicAngle ${decimal(face.italicAngle)} /Ascent ${units(face.ascender)} /Descent ${units(face.descender)} /CapHeight ${units(face.capHeight)} /StemV 80 /FontFile2 ${program} 0 R >>`,
	);
	const bytes = subset.program();
	await writer.compressed(program, `/Length1 ${bytes.length}`, bytes);
	await writer.compressed(toUnicode, "", toUnicodeMap(subset.codePoints));
}

/** Six capital letters naming the subset, the same for the same glyphs (ISO 32000-1, 9.6.4). */
function subsetTag(glyphs: readonly number[]): string {
	let hash = 0x811c9dc5; // FNV-1a
	for (const glyph of glyphs) hash = Math.imul(hash ^ glyph, 0x01000193) >>> 0;
	let tag = "";
	for (let i = 0; i < 6; i++) {
		tag += String.fromCharCode(65 + (hash % 26));
		hash = Math.floor(hash / 26);
	}
	return tag;
}

/** Glyph to text, for every glyph the subset draws text with (ISO 32000-1, 9.10.3). */
function toUnicodeMap(codePoints: readonly (number | undefined)[]): string {
	const hex4 = (value: number) => value.toString(16).padStart(4, "0");
	const entries: string[] = [];
	codePoints.forEach((codePoint, id) => {
		if (codePoint === undefined) return;
		const text = String.fromCodePoint(codePoint);
		let utf16 = "";
		for (let i = 0; i < text.length; i++) utf16 += hex4(text.charCodeAt(i));
		entries.push(`<${hex4(id)}> <${utf16}>`);
	});
	const BATCH = 100; // a bfchar section holds at most 100 entries
	let ranges = "";
	for (let i = 0; i < entries.length; i += BATCH) {
		const batch = entries.slice(i, i + BATCH);
		ranges += `${batch.length} beginbfchar\n${batch.join("\n")}\nendbfchar\n`;
	}
	return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n${ranges}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}
