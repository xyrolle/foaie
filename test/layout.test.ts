import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import {
	type Block,
	type Cell,
	type Document,
	PdfError,
	render,
} from "../src/index.ts";
import { defaultCascade, Styles } from "../src/layout/style.ts";
import { widthOf } from "../src/text/glyphs.ts";
import { breakLines } from "../src/text/lines.ts";
import { pageTexts } from "./readers.ts";
import { roboto } from "./roboto.ts";

const family = roboto();
const page = (content: Block[], extra: Partial<Document> = {}): Document => ({
	page: { size: "A5", margin: 36 },
	fonts: { Roboto: family },
	style: { font: "Roboto", size: 10 },
	content,
	...extra,
});

/** The lines `text` breaks into at `width` points, in the document's default style. */
function linesOf(text: string, width: number): string[] {
	const styles = new Styles({ Roboto: family });
	const style = styles.style(defaultCascade({ font: "Roboto", size: 10 }));
	return breakLines([{ text, style, link: undefined }], width).map((line) =>
		line.pieces.map((piece) => piece.text).join(""),
	);
}

/** A block as data from outside might hold it, naming two kinds at once. */
const twoKinds: Block = JSON.parse('{ "text": "x", "stack": [] }');

async function errorOf(document: Document): Promise<unknown> {
	try {
		await render(document);
	} catch (error) {
		return error;
	}
	throw new Error("expected render() to throw");
}

describe("line breaking", () => {
	it("breaks at spaces and after hyphens", () => {
		expect(linesOf("Zoë Łukasiewicz-Ørsted signed", 100)).toEqual([
			"Zoë Łukasiewicz-",
			"Ørsted signed",
		]);
	});

	it("never breaks at a no-break space", () => {
		expect(linesOf("Total 1 234 567.89 EUR", 60)).toEqual([
			"Total",
			"1 234 567.89",
			"EUR",
		]);
	});

	it("sets spaces in a row as one, and drops the spaces at a line's ends", () => {
		expect(linesOf("  Total   due  ", 200)).toEqual(["Total due"]);
		expect(linesOf("  Total   due  ", 30)).toEqual(["Total", "due"]);
	});

	it("reads a tab as a space, and a carriage return, alone or before a line feed, as a line break", () => {
		expect(linesOf("one\ttwo\r\nthree\rfour", 200)).toEqual([
			"one two",
			"three",
			"four",
		]);
	});

	it("measures a line as it draws, kerning between the runs it joins included", () => {
		const style = new Styles({ Roboto: family }).style(
			defaultCascade({ font: "Roboto", size: 10 }),
		);
		const [line] = breakLines(
			[
				{ text: "A", style, link: undefined },
				{ text: "V", style, link: undefined },
			],
			200,
		);
		expect(line?.width).toBe(widthOf(style.use.face, "AV", 10));
	});

	it("breaks a word wider than the line between its characters, filling each line", () => {
		const word =
			"Rindfleischetikettierungsüberwachungsaufgabenübertragungsgesetz";
		const lines = linesOf(word, 100);
		expect(lines.length).toBeGreaterThan(1);
		expect(lines.join("")).toBe(word);
		const face = new Styles({ Roboto: family }).style(
			defaultCascade({ font: "Roboto", size: 10 }),
		).use.face;
		for (const [i, line] of lines.slice(0, -1).entries()) {
			const nextCharacter = lines[i + 1]?.charAt(0) ?? "";
			expect(widthOf(face, line, 10)).toBeLessThanOrEqual(100);
			expect(widthOf(face, line + nextCharacter, 10)).toBeGreaterThan(100);
		}
	});
});

describe("page breaking", () => {
	it("moves a row whole to the next page when it fits on one", async () => {
		const tall = Array.from({ length: 6 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		);
		const rows = [
			...Array.from({ length: 30 }, (_, i) => [`row ${i + 1}`]),
			[`last ${tall}`],
		];
		const pages = await pageTexts(
			await render(page([{ table: { widths: ["*"], rows } }])),
		);
		expect(pages).toHaveLength(2);
		expect(pages[1]).toMatch(/^last line 1/);
	});

	it("splits a row taller than a page between its lines, repeating the header", async () => {
		const tall = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join(
			"\n",
		);
		const pages = await pageTexts(
			await render(
				page([
					{ table: { widths: ["*"], header: [["Header"]], rows: [[tall]] } },
				]),
			),
		);
		expect(pages.length).toBeGreaterThan(1);
		for (const text of pages) expect(text).toMatch(/^Header/);
		expect(pages.join("\n")).toContain("line 80");
	});

	it("keeps a heading with the table after it", async () => {
		const filler = Array.from({ length: 43 }, (_, i) => ({
			text: `filler ${i + 1}`,
		}));
		const content: Block[] = [
			...filler,
			{ text: "Heading", bold: true, keepWithNext: true },
			{ table: { widths: ["*"], rows: [["first row"]] } },
		];
		const pages = await pageTexts(await render(page(content)));
		expect(pages[1]).toMatch(/^Heading\s*first row/);
	});

	it("moves a stack kept together to the next page whole", async () => {
		const filler = Array.from({ length: 42 }, (_, i) => ({
			text: `filler ${i + 1}`,
		}));
		const signature: Block = {
			stack: [{ text: "Signed" }, { text: "Name" }, { text: "Date" }],
			keepTogether: true,
		};
		const pages = await pageTexts(await render(page([...filler, signature])));
		expect(pages[1]).toMatch(/^Signed\s*Name\s*Date/);
	});
});

describe("table borders", () => {
	/** The lines a one-cell grid table strokes, read from its page's content. */
	async function strokes(cell: Cell): Promise<number> {
		const pdf = await render(
			page([{ table: { widths: ["*"], borders: "grid", rows: [[cell]] } }]),
		);
		return new TextDecoder("latin1").decode(pdf).match(/ l S/g)?.length ?? 0;
	}

	it("draws the sides a cell turns off or on, and the table's for a side it leaves undefined", async () => {
		expect(await strokes("x")).toBe(4);
		expect(await strokes({ text: "x", border: { top: false } })).toBe(3);
		const unsaid = Object.fromEntries([["top", undefined]]);
		expect(await strokes({ text: "x", border: unsaid })).toBe(4);
	});
});

describe("headers and footers", () => {
	it("lays out the header in every page's top margin, knowing the page count", async () => {
		const content = Array.from({ length: 60 }, (_, i) => ({
			text: `line ${i + 1}`,
		}));
		const pages = await pageTexts(
			await render(
				page(content, {
					header: ({ page, pages }) => [
						{ text: `Header ${page}/${pages}`, spaceBefore: 12 },
					],
				}),
			),
		);
		expect(pages).toHaveLength(2);
		for (const [i, text] of pages.entries())
			expect(text).toContain(`Header ${i + 1}/2`);
	});
});

describe("links and metadata", () => {
	it("links a span's text to its URL, and writes the document's information and language", async () => {
		const pdf = await render(
			page(
				[
					{
						text: [
							"Read the ",
							{ text: "terms", link: "https://example.com/terms" },
							".",
						],
					},
				],
				{
					info: {
						title: "Terms",
						author: "Ana-Maria Țăranu",
						created: new Date(Date.UTC(2026, 2, 12, 10, 30)),
					},
					lang: "ro-MD",
				},
			),
		);
		const loading = getDocument({ data: pdf, verbosity: 0 });
		const document = await loading.promise;
		const annotations = await (await document.getPage(1)).getAnnotations();
		const { info } = await document.getMetadata();
		await loading.destroy();
		expect(annotations).toEqual([
			expect.objectContaining({
				subtype: "Link",
				url: "https://example.com/terms",
			}),
		]);
		expect(info).toMatchObject({
			Title: "Terms",
			Author: "Ana-Maria Țăranu",
			CreationDate: "D:20260312103000Z",
			Language: "ro-MD",
		});
	});

	it("writes only the information a document gives, as a caller in plain JavaScript might give it", async () => {
		// Information built from a record: an author it doesn't know, and a key foaie doesn't write.
		const info = Object.fromEntries([
			["title", "Terms"],
			["author", undefined],
			["producer", "Billing 2.1"],
		]);
		const pdf = await render(page([{ text: "x" }], { info }));
		const written = new TextDecoder("latin1").decode(pdf);
		expect(written).toContain("/Title");
		expect(written).not.toContain("/Author");
		expect(written).not.toContain("/Producer");
	});
});

describe("what foaie refuses", () => {
	it.each<[string, Document, string]>([
		[
			"a family the fonts lack",
			page([{ text: "x", font: "Inter" }]),
			"face-missing",
		],
		[
			"a face the family lacks",
			{
				...page([{ text: "x", bold: true }]),
				fonts: { Roboto: { normal: family.normal } },
			},
			"face-missing",
		],
		["a block with two kinds", page([twoKinds]), "block-invalid"],
		[
			"a colour it can't read",
			page([{ text: "x", color: "#12" }]),
			"color-invalid",
		],
		[
			"a table wider than the page",
			page([{ table: { widths: [200, 200], rows: [["a", "b"]] } }]),
			"table-too-wide",
		],
		[
			"a row spanning more columns than the table has",
			page([{ table: { widths: ["*", "*"], rows: [["a", "b", "c"]] } }]),
			"block-invalid",
		],
		[
			"a row spanning fewer columns than the table has",
			page([{ table: { widths: ["*", "*"], rows: [["a", "b"], ["c"]] } }]),
			"block-invalid",
		],
		[
			"a cell spanning no columns",
			page([{ table: { widths: ["*"], rows: [[{ text: "a", colSpan: 0 }]] } }]),
			"block-invalid",
		],
		[
			"an auto column narrower than a word its no-break spaces hold together",
			page([
				{
					table: {
						widths: [297, "auto"],
						rows: [["Total", "1\u00a0234\u00a0567.89"]],
					},
				},
			]),
			"table-too-wide",
		],
		[
			"margins that leave no room on the page",
			page([{ text: "x" }], {
				page: {
					size: "A5",
					margin: { top: 36, right: 220, bottom: 36, left: 220 },
				},
			}),
			"page-too-small",
		],
		[
			"a line taller than the page's body",
			page([{ text: "x", size: 600 }]),
			"page-too-small",
		],
		[
			"a table header that leaves no room for a row",
			page([
				{
					table: {
						widths: ["*"],
						header: [[Array.from({ length: 50 }, () => "header").join("\n")]],
						rows: [["row"]],
					},
				},
			]),
			"page-too-small",
		],
		[
			"a footer taller than its margin",
			page([{ text: "x" }], {
				footer: () => [{ text: "one\ntwo\nthree\nfour" }],
			}),
			"decoration-too-tall",
		],
	])("%s", async (_, document, code) => {
		const error = await errorOf(document);
		expect(error).toBeInstanceOf(PdfError);
		expect(error).toMatchObject({ code });
	});
});
