// What a reader gets back from the text a page draws: every character, as it was written.

import { describe, expect, it } from "vitest";
import { type Document, render } from "../src/index.ts";
import { pageTexts } from "./readers.ts";
import { roboto } from "./roboto.ts";

const family = roboto();
const paragraph = (text: string): Document => ({
	page: { size: "A5", margin: 36 },
	fonts: { Roboto: family },
	style: { font: "Roboto", size: 10 },
	content: [{ text }],
});

describe("the text a reader extracts", () => {
	it("is each character as written, when two characters share a glyph", async () => {
		// Roboto draws the increment sign ∆ and the Greek capital Δ with one glyph.
		const [text] = await pageTexts(await render(paragraph("∆t = 2 s, Δ = 4")));
		expect(text).toBe("∆t = 2 s, Δ = 4");
	});

	it("is each character the face lacks, though it prints the face's .notdef box", async () => {
		const [text] = await pageTexts(await render(paragraph("Total 漢字 ✓")));
		expect(text).toBe("Total 漢字 ✓");
	});
});
