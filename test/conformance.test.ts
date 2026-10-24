// Every reference document, opened by real readers: pdf.js extracts the text the definition holds,
// and qpdf finds nothing wrong where it is installed.

import { describe, expect, it } from "vitest";
import { type Block, type Document, render, type Span } from "../src/index.ts";
import { invoice, ledger, NAMES, priceList } from "./documents.ts";
import { pageTexts, qpdfCheck, qpdfInstalled } from "./readers.ts";
import { roboto } from "./roboto.ts";

const family = roboto();
const documents: [string, Document][] = [
	["the typical invoice", invoice(family, "typical")],
	["the largest invoice", invoice(family, "largest")],
	["a price list of 14 rows", priceList(family, 14)],
	["a price list of 120 rows", priceList(family, 120)],
	["a ledger of 300 rows", ledger(family, 300)],
];

/** Every text a definition's blocks hold: each paragraph, and each table cell. */
function textsOf(blocks: readonly Block[]): string[] {
	return blocks.flatMap((block) => {
		if ("text" in block) return [plain(block.text)];
		if ("table" in block)
			return [...(block.table.header ?? []), ...block.table.rows]
				.flat()
				.map((cell) => (typeof cell === "string" ? cell : plain(cell.text)));
		if ("stack" in block) return textsOf(block.stack);
		return [];
	});
}

const plain = (text: string | readonly Span[]) =>
	typeof text === "string"
		? text
		: text
				.map((span) => (typeof span === "string" ? span : span.text))
				.join("");

/** Text with its spacing and line breaks taken out: lines break where the layout chose. */
const unspaced = (text: string) => text.normalize("NFC").replace(/\s+/g, "");

describe.each(documents)("%s", (_, document) => {
	it("passes qpdf's check", async ({ skip }) => {
		if (!qpdfInstalled) skip("qpdf isn't installed");
		expect(qpdfCheck(await render(document))).toContain(
			"No syntax or stream encoding errors found",
		);
	});

	it("renders the same bytes every time", async () => {
		expect(await render(document)).toEqual(await render(document));
	});

	it("gives pdf.js back every text it holds, as written", async () => {
		const pages = await pageTexts(await render(document));
		const extracted = unspaced(pages.join(""));
		for (const text of textsOf(document.content))
			expect(extracted).toContain(unspaced(text));
	});
});

describe("the text pdf.js extracts", () => {
	it("is every name in every script, as written", async () => {
		const text = (
			await pageTexts(await render(invoice(family, "largest")))
		).join("\n");
		for (const name of NAMES) expect(text).toContain(name);
	});

	it("continues a table on the next page with its header", async () => {
		const pages = await pageTexts(await render(priceList(family, 120)));
		expect(pages.length).toBeGreaterThan(1);
		for (const page of pages.slice(1))
			expect(page).toMatch(/^Item\s*Kind\s*Hours/);
		expect(pages.join("\n")).toContain("Item 120. Maintenance");
	});

	it("numbers every page of the ledger in its footer", async () => {
		const pages = await pageTexts(await render(ledger(family, 300)));
		for (const [i, page] of pages.entries())
			expect(page).toContain(`Page ${i + 1} of ${pages.length}`);
	});
});
