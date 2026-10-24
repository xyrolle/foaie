import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PdfError } from "../src/errors.ts";
import { font, trueTypeOf } from "../src/font/font.ts";
import { GlyphSubset } from "../src/font/subset.ts";

const roboto = readFileSync(
	new URL("fonts/Roboto-Regular.ttf", import.meta.url),
);
const parsed = (bytes: Uint8Array) => {
	const face = trueTypeOf(font(bytes));
	if (!face) throw new Error("font() returned a handle without a face");
	return face;
};

const errorOf = (run: () => unknown) => {
	try {
		run();
	} catch (error) {
		return error;
	}
	throw new Error("expected an error");
};

describe("font()", () => {
	it("reads a TrueType face's name, metrics and character map", () => {
		const face = parsed(roboto);
		expect(font(roboto).name).toBe("Roboto-Regular");
		expect(face.unitsPerEm).toBe(2048);
		expect(face.glyph("ț".codePointAt(0) ?? 0)).toBeGreaterThan(0);
		expect(face.glyph(0x10ffff)).toBe(0);
	});

	it("kerns the pairs the face kerns", () => {
		const face = parsed(roboto);
		expect(face.kerning(face.glyph(65), face.glyph(86))).toBeLessThan(0); // "AV"
		expect(face.kerning(face.glyph(72), face.glyph(72))).toBe(0); // "HH"
	});

	it.each([
		["OpenType with CFF outlines", "OTTO"],
		["WOFF", "wOFF"],
		["WOFF2", "wOF2"],
		["a font collection", "ttcf"],
	])("refuses %s, naming the TTF build as the fix", (format, signature) => {
		const bytes = new Uint8Array(64);
		bytes.set(new TextEncoder().encode(signature));
		const error = errorOf(() => font(bytes));
		expect(error).toBeInstanceOf(PdfError);
		expect(error).toMatchObject({
			code: "font-format",
			message: expect.stringContaining(format),
		});
	});

	it("reports a truncated file as broken", () => {
		expect(errorOf(() => font(roboto.subarray(0, 2000)))).toMatchObject({
			code: "font-invalid",
		});
	});
});

describe("a subset", () => {
	it("is a TrueType program of the glyphs drawn, with their advances", () => {
		const face = parsed(roboto);
		const subset = new GlyphSubset(face);
		const text = "Ștefan Ἀθῆναι Ёлка";
		for (const char of text)
			subset.use(
				face.glyph(char.codePointAt(0) ?? 0),
				char.codePointAt(0) ?? 0,
			);
		const program = parsed(subset.program());
		expect(program.glyphCount).toBe(subset.glyphs.length);
		for (const [id, glyph] of subset.glyphs.entries())
			expect(program.advances[id]).toBe(face.advances[glyph]);
	});

	it("brings in the parts of the composite glyphs it draws", () => {
		const face = parsed(roboto);
		const composite = [..."ÁÉÍÓÚáéíóúĂăȘșȚț"]
			.map((char) => char.codePointAt(0) ?? 0)
			.find((codePoint) => {
				const outline = face.outline(face.glyph(codePoint));
				return (
					outline.length > 0 &&
					new DataView(outline.buffer, outline.byteOffset).getInt16(0) < 0
				);
			});
		expect(composite).toBeDefined();
		const subset = new GlyphSubset(face);
		subset.use(face.glyph(composite ?? 0), composite ?? 0);
		const before = subset.glyphs.length;
		parsed(subset.program());
		expect(subset.glyphs.length).toBeGreaterThan(before);
	});
});
