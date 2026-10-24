// A document's definition, laid out page by page and written as a PDF.

import type { Document } from "./document.ts";
import { type Layout, placeBlocks } from "./layout/blocks.ts";
import { decorate } from "./layout/decorations.ts";
import { Flow } from "./layout/flow.ts";
import { PageContent } from "./layout/page.ts";
import { decimal as d, defaultCascade, Styles } from "./layout/style.ts";
import { writeFont } from "./pdf/fonts.ts";
import { ImageObjects } from "./pdf/images.ts";
import { type WrittenPage, writeCatalog, writePages } from "./pdf/pages.ts";
import { PdfWriter } from "./pdf/writer.ts";
import { pageSize, sides } from "./units.ts";

const DEFAULT_OPACITY = 0.15;

/** Lays out `document` and writes it as PDF bytes. The same definition always renders the same bytes. */
export async function render(document: Document): Promise<Uint8Array> {
	const size = pageSize(document.page.size, document.page.landscape ?? false);
	const [width, height] = size;
	const margin = sides(document.page.margin);
	const writer = new PdfWriter();
	const styles = new Styles(document.fonts);
	const images = new ImageObjects(writer);
	const layout: Layout = {
		styles,
		sizeOf: (picture, available) => images.sizeOf(picture, available),
		draw: (flow, picture, w, h) => images.draw(flow, picture, w, h),
	};
	const cascade = defaultCascade(document.style);
	const pages: WrittenPage[] = [];

	// A page's body is written as soon as it is full, and compresses while the next pages are laid
	// out: only a few pages are ever held. It is wrapped in q … Q, so the decorations' stream that
	// follows starts from the page's initial graphics state.
	const finish = async (content: PageContent) => {
		const stream = writer.reserve();
		await writer.compressed(stream, "", `q\n${content.take()}\nQ`);
		pages.push({ content, streams: [stream] });
	};
	const area = {
		x: margin.left,
		top: margin.top,
		width: width - margin.left - margin.right,
		bottom: height - margin.bottom,
	};
	const flow = new Flow(area, new PageContent(width, height), async () => {
		await finish(flow.page);
		return new PageContent(width, height);
	});
	await placeBlocks(layout, flow, document.content, cascade);
	await finish(flow.page);

	if (document.header || document.footer || document.watermark)
		for (const [index, page] of pages.entries()) {
			await decorate(
				layout,
				document,
				page.content,
				margin,
				{ page: index + 1, pages: pages.length },
				cascade,
			);
			const stream = writer.reserve();
			await writer.compressed(stream, "", page.content.take());
			page.streams.push(stream);
		}

	const fonts = new Map(styles.uses.map((use) => [use, writer.reserve()]));
	for (const [use, reference] of fonts) await writeFont(writer, use, reference);
	const translucency = document.watermark ? writer.reserve() : undefined;
	if (translucency)
		writer.object(
			translucency,
			`<< /Type /ExtGState /ca ${d(document.watermark?.opacity ?? DEFAULT_OPACITY)} >>`,
		);
	const tree = writePages(writer, pages, { size, fonts, translucency });
	return writer.finish(writeCatalog(writer, tree, document));
}
