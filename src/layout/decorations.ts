// What every page carries besides its body: the header and footer, laid out in the margins once the
// page count is known, and the watermark across the page.

import type { Document, Sides } from "../document.ts";
import { advance } from "../text/glyphs.ts";
import { type Layout, placeBlocks } from "./blocks.ts";
import { Flow } from "./flow.ts";
import type { PageContent } from "./page.ts";
import { type Cascade, decimal as d } from "./style.ts";

/** The watermark spans this share of the page's diagonal unless it names a size. */
const WATERMARK_SPAN = 0.6;

export async function decorate(
	layout: Layout,
	document: Document,
	page: PageContent,
	margin: Sides<number>,
	at: { page: number; pages: number },
	cascade: Cascade,
): Promise<void> {
	const x = margin.left;
	const width = page.width - margin.left - margin.right;
	if (document.header)
		await placeBlocks(
			layout,
			new Flow({ x, width, top: 0, bottom: margin.top }, page),
			document.header(at),
			cascade,
		);
	if (document.footer)
		await placeBlocks(
			layout,
			new Flow(
				{ x, width, top: page.height - margin.bottom, bottom: page.height },
				page,
			),
			document.footer(at),
			cascade,
		);
	if (document.watermark?.text)
		watermark(layout, document.watermark, page, cascade);
}

/** The watermark's text, centred on the page and rotated. */
function watermark(
	layout: Layout,
	mark: NonNullable<Document["watermark"]>,
	page: PageContent,
	parent: Cascade,
): void {
	const text = mark.text.normalize("NFC");
	const cascade = layout.styles.cascade(parent, mark);
	const unsized = layout.styles.style(cascade);
	const { face } = unsized.use;
	const textWidth = advance(face, text) / face.unitsPerEm;
	const size =
		mark.size ??
		(WATERMARK_SPAN * Math.hypot(page.width, page.height)) / textWidth;
	const style = layout.styles.style({ ...cascade, size });
	const angle = ((mark.angle ?? 45) * Math.PI) / 180;
	const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
	// The text's centre (half its width along, half its cap height up) lands on the page's centre.
	const half = {
		along: (textWidth * size) / 2,
		up: (face.capHeight / face.unitsPerEm) * size * 0.5,
	};
	const x = page.width / 2 - half.along * cos + half.up * sin;
	const y = page.height / 2 - half.along * sin - half.up * cos;
	page.watermark(style, text, [cos, sin, -sin, cos, x, y].map(d).join(" "));
}
