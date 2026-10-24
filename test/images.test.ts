import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pdfImageOf } from "../src/image/image.ts";
import { type Document, type Image, image, render } from "../src/index.ts";
import { png } from "./png.ts";
import { qpdfCheck, qpdfInstalled } from "./readers.ts";
import { roboto } from "./roboto.ts";

const family = roboto();
const pageWith = (picture: Image): Document => ({
	page: { size: "A5", margin: 36 },
	fonts: { Roboto: family },
	style: { font: "Roboto" },
	content: [
		{ text: "Above" },
		{ image: picture, width: 120 },
		{ text: "Below" },
	],
});

async function rejection(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (error) {
		return error;
	}
	throw new Error("expected a rejection");
}

describe("image()", () => {
	it("reads a JPEG's size and embeds it as it is", async () => {
		const bytes = readFileSync(new URL("images/gradient.jpg", import.meta.url));
		const picture = await image(bytes);
		expect(picture).toEqual({ width: 64, height: 32 });
		expect(pdfImageOf(picture)?.dictionary).toContain("/DCTDecode");
		expect(pdfImageOf(picture)?.data).toEqual(new Uint8Array(bytes));
	});

	it.each([
		["grey", { colorType: 0, depth: 8 }],
		["RGB", { colorType: 2, depth: 8 }],
		["a palette", { colorType: 3, depth: 8 }],
		["16-bit RGB", { colorType: 2, depth: 16 }],
	] as const)("embeds a %s PNG without decoding it", async (_, shape) => {
		const picture = await image(png(shape));
		expect(pdfImageOf(picture)?.dictionary).toContain("/Predictor 15");
		expect(pdfImageOf(picture)?.mask).toBeUndefined();
	});

	it("splits an alpha channel into a soft mask, undoing every PNG filter", async () => {
		const pixels = inflateSync(
			pdfImageOf(await image(png({ colorType: 6, depth: 8 })))?.mask?.data ??
				new Uint8Array(),
		);
		// The alpha channel is the fourth: (x + y + 9) / 33 of full, row by row.
		const expected = Array.from({ length: 8 * 16 }, (_, i) =>
			Math.round((((i % 16) + Math.floor(i / 16) + 9) / 33) * 255),
		);
		expect([...pixels]).toEqual(expected);
	});

	it("masks a palette image by its transparency chunk", async () => {
		const picture = pdfImageOf(
			await image(
				png({
					colorType: 3,
					depth: 8,
					transparency: new Uint8Array([0, 255, 255, 128]),
				}),
			),
		);
		const alpha = inflateSync(picture?.mask?.data ?? new Uint8Array());
		expect([...alpha.subarray(0, 4)]).toEqual([0, 255, 255, 128]);
	});

	it("masks a grey or RGB image's one transparent colour without decoding it", async () => {
		const picture = pdfImageOf(
			await image(
				png({ colorType: 0, depth: 8, transparency: new Uint8Array([0, 7]) }),
			),
		);
		expect(picture?.dictionary).toContain("/Mask [7 7]");
	});

	it("refuses an interlaced PNG and other formats, and reports a truncated file", async () => {
		expect(
			await rejection(image(png({ colorType: 2, depth: 8, interlaced: true }))),
		).toMatchObject({ code: "image-format" });
		expect(
			await rejection(image(new TextEncoder().encode("GIF89a"))),
		).toMatchObject({ code: "image-format" });
		expect(
			await rejection(image(png({ colorType: 2, depth: 8 }).subarray(0, 40))),
		).toMatchObject({ code: "image-invalid" });
	});
});

describe("a picture", () => {
	it.each([
		[
			"a JPEG",
			() => readFileSync(new URL("images/gradient.jpg", import.meta.url)),
		],
		["a transparent PNG", () => png({ colorType: 6, depth: 16 })],
	])("with %s is a valid PDF", async (_, bytes) => {
		const pdf = await render(pageWith(await image(bytes())));
		if (qpdfInstalled)
			expect(qpdfCheck(pdf)).toContain(
				"No syntax or stream encoding errors found",
			);
		expect(new TextDecoder("latin1").decode(pdf)).toContain("/Subtype /Image");
	});

	it("is written once however often it is placed", async () => {
		const picture = await image(png({ colorType: 2, depth: 8 }));
		const pdf = await render({
			...pageWith(picture),
			content: [{ image: picture }, { image: picture }],
		});
		expect(
			new TextDecoder("latin1").decode(pdf).match(/\/Subtype \/Image/g),
		).toHaveLength(1);
	});
});
