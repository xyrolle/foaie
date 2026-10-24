// Layout, compared by eye's proxy: pages rendered by pdf.js in Chromium, glyphs drawn as paths so
// every platform rasterises them alike, against golden images in test/golden.
// UPDATE_GOLDEN=1 writes the goldens anew; review them before committing.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { type Browser, chromium, type Page } from "playwright-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Document, image, render } from "../src/index.ts";
import { invoice, ledger, priceList } from "./documents.ts";
import { png } from "./png.ts";
import { roboto } from "./roboto.ts";

const PDFJS = new URL("../node_modules/pdfjs-dist/build/", import.meta.url);
const update = process.env.UPDATE_GOLDEN === "1";
/** A pixel differs when a channel is this far apart; a page may differ in this share of its pixels. */
const CHANNEL_TOLERANCE = 48;
const PIXEL_SHARE = 0.002;

const PAGE = `<!doctype html><script type="module">
import * as pdfjs from "/pdfjs/pdf.mjs";
pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.mjs";
const pixels = async (url) => {
	const image = await createImageBitmap(await (await fetch(url)).blob());
	const canvas = new OffscreenCanvas(image.width, image.height);
	const context = canvas.getContext("2d");
	context.drawImage(image, 0, 0);
	return context.getImageData(0, 0, image.width, image.height);
};
window.renderPage = async (base64, number) => {
	const data = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
	const pdf = await pdfjs.getDocument({ data, disableFontFace: true, verbosity: 0 }).promise;
	const page = await pdf.getPage(number);
	const viewport = page.getViewport({ scale: 1.5 });
	const target = new OffscreenCanvas(Math.round(viewport.width), Math.round(viewport.height));
	const context = target.getContext("2d");
	context.fillStyle = "#fff";
	context.fillRect(0, 0, target.width, target.height);
	await page.render({ canvasContext: context, canvas: target, viewport }).promise;
	const blob = await target.convertToBlob({ type: "image/png" });
	return new Uint8Array(await blob.arrayBuffer()).toBase64();
};
window.differingShare = async (actualBase64, goldenBase64, tolerance) => {
	const [a, b] = await Promise.all([actualBase64, goldenBase64].map((png) => pixels("data:image/png;base64," + png)));
	if (a.width !== b.width || a.height !== b.height) return 1;
	let differing = 0;
	for (let i = 0; i < a.data.length; i += 4)
		if (Math.max(...[0, 1, 2].map((c) => Math.abs(a.data[i + c] - b.data[i + c]))) > tolerance) differing++;
	return differing / (a.width * a.height);
};
window.ready = true;
</script>`;

let browser: Browser;
let page: Page;

beforeAll(async () => {
	browser = await chromium.launch();
	page = await browser.newPage();
	await page.route("http://foaie.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path.startsWith("/pdfjs/"))
			return route.fulfill({
				body: readFileSync(new URL(path.slice("/pdfjs/".length), PDFJS)),
				contentType: "text/javascript",
			});
		return route.fulfill({ body: PAGE, contentType: "text/html" });
	});
	await page.goto("http://foaie.test/");
	await page.waitForFunction(() => "ready" in window);
});

afterAll(async () => {
	await browser?.close();
});

async function checkPage(
	name: string,
	document: Document,
	number = 1,
): Promise<void> {
	const pdf = Buffer.from(await render(document)).toString("base64");
	const actual: string = await page.evaluate(
		`renderPage(${JSON.stringify(pdf)}, ${number})`,
	);
	const file = new URL(`golden/${name}.png`, import.meta.url);
	if (update) {
		writeFileSync(file, Buffer.from(actual, "base64"));
		return;
	}
	if (!existsSync(file))
		throw new Error(
			`No golden image ${name}.png: run the tests with UPDATE_GOLDEN=1 and review it.`,
		);
	const golden = readFileSync(file).toString("base64");
	const share: number = await page.evaluate(
		`differingShare(${JSON.stringify(actual)}, ${JSON.stringify(golden)}, ${CHANNEL_TOLERANCE})`,
	);
	expect(share).toBeLessThan(PIXEL_SHARE);
}

describe("pages match their golden images", () => {
	const family = roboto();
	it("the typical invoice", () =>
		checkPage("invoice-typical", invoice(family, "typical")));
	it("the largest invoice's first page", () =>
		checkPage("invoice-largest", invoice(family, "largest")));
	it("a price list's second page, its header repeated", () =>
		checkPage("price-list-2", priceList(family, 120), 2));
	it("a ledger's second page, with its bands, footer and watermark", () =>
		checkPage("ledger-2", ledger(family, 300), 2));
	it("pictures: a JPEG, and a PNG with an alpha channel, below a filled cell", async () => {
		const jpeg = await image(
			readFileSync(new URL("images/gradient.jpg", import.meta.url)),
		);
		const transparent = await image(png({ colorType: 6, depth: 8 }, 64, 32));
		await checkPage("pictures", {
			page: { size: "A5", margin: 36 },
			fonts: { Roboto: family },
			style: { font: "Roboto" },
			content: [
				{ text: "A JPEG, centred, 200 points wide:" },
				{ image: jpeg, width: 200, align: "center", spaceAfter: 12 },
				{
					table: {
						widths: ["*"],
						rows: [
							[
								{
									text: "Below, a PNG whose alpha channel blends it with the page:",
									fill: "#ccc",
								},
							],
						],
					},
				},
				{ image: transparent, height: 80 },
			],
		});
	});
});
