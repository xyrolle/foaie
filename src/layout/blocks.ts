// Blocks set down the flow in order, kept with what follows them or kept together when asked.

import type { Block, Picture } from "../document.ts";
import { PdfError } from "../errors.ts";
import type { Flow } from "./flow.ts";
import { heightOf, paragraphLines, placeLines } from "./paragraph.ts";
import type { Cascade, Styles } from "./style.ts";
import { TableLayout } from "./table.ts";

/** What a render's layout shares: its styles, and how an image is sized and drawn. */
export type Layout = {
	styles: Styles;
	sizeOf: (
		picture: Picture,
		available: number,
	) => { width: number; height: number };
	draw: (flow: Flow, picture: Picture, width: number, height: number) => void;
};

const KINDS = ["text", "table", "image", "stack"] as const;

/** Each block is named by exactly one key. */
function checkKind(block: Block): void {
	const kinds = KINDS.filter((kind) => kind in block);
	if (kinds.length !== 1)
		throw new PdfError(
			"block-invalid",
			`A block has ${kinds.length === 0 ? "none" : `all of ${kinds.join(", ")}`} of the keys text, table, image and stack. Give it exactly one.`,
		);
}

export async function placeBlocks(
	layout: Layout,
	flow: Flow,
	blocks: readonly Block[],
	cascade: Cascade,
): Promise<void> {
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i];
		if (!block) continue;
		checkKind(block);
		flow.y += block.spaceBefore ?? 0;
		const next = blocks[i + 1];
		if ("text" in block && block.keepWithNext && next) {
			const together =
				heightOf(
					paragraphLines(layout.styles, cascade, block, flow.area.width),
				) +
				(block.spaceAfter ?? 0) +
				(next.spaceBefore ?? 0) +
				measure(layout, flow, next, cascade, "start");
			if (together <= flow.pageHeight) await flow.fit(together);
		}
		if (("table" in block || "stack" in block) && block.keepTogether) {
			const whole = measure(layout, flow, block, cascade, "whole");
			if (whole <= flow.pageHeight) await flow.fit(whole);
		}
		await placeBlock(layout, flow, block, cascade);
		flow.y += block.spaceAfter ?? 0;
	}
}

async function placeBlock(
	layout: Layout,
	flow: Flow,
	block: Block,
	cascade: Cascade,
): Promise<void> {
	if ("text" in block)
		return placeLines(
			flow,
			paragraphLines(layout.styles, cascade, block, flow.area.width),
			block.align,
		);
	if ("table" in block)
		return new TableLayout(
			layout.styles,
			cascade,
			block,
			flow.area.x,
			flow.area.width,
		).place(flow);
	if ("image" in block) {
		const { width, height } = fitted(layout, flow, block);
		await flow.fit(height);
		layout.draw(flow, block, width, height);
		flow.y += height;
		return;
	}
	return placeBlocks(layout, flow, block.stack, cascade);
}

/** An image's size, scaled down to fit a page's body when it is taller. */
function fitted(
	layout: Layout,
	flow: Flow,
	picture: Picture,
): { width: number; height: number } {
	const { width, height } = layout.sizeOf(picture, flow.area.width);
	const scale = Math.min(1, flow.pageHeight / height);
	return { width: width * scale, height: height * scale };
}

/** A block's height: all of it, or what must fit for it to start on a page (its first line or row). */
function measure(
	layout: Layout,
	flow: Flow,
	block: Block,
	cascade: Cascade,
	part: "whole" | "start",
): number {
	checkKind(block);
	const { styles } = layout;
	if ("text" in block) {
		const lines = paragraphLines(styles, cascade, block, flow.area.width);
		return part === "whole" ? heightOf(lines) : (lines[0]?.height ?? 0);
	}
	if ("table" in block) {
		const table = new TableLayout(
			styles,
			cascade,
			block,
			flow.area.x,
			flow.area.width,
		);
		return part === "whole" ? table.height() : table.startHeight();
	}
	if ("image" in block) return fitted(layout, flow, block).height;
	if (part === "start") {
		const [first] = block.stack;
		return first
			? (first.spaceBefore ?? 0) +
					measure(layout, flow, first, cascade, "start")
			: 0;
	}
	return block.stack.reduce(
		(sum, child) =>
			sum +
			(child.spaceBefore ?? 0) +
			measure(layout, flow, child, cascade, "whole") +
			(child.spaceAfter ?? 0),
		0,
	);
}
