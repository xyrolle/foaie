// A paragraph: styled runs broken into lines and set down the flow, a line at a time.

import type { Align, Paragraph, Span } from "../document.ts";
import { breakLines, type Line, type Run } from "../text/lines.ts";
import type { Flow } from "./flow.ts";
import type { Cascade, Styles } from "./style.ts";

/** The runs of a paragraph's or a cell's text, each span in its own style; text is NFC from here on. */
export function runsOf(
	styles: Styles,
	cascade: Cascade,
	text: string | readonly Span[],
	link: string | undefined,
): Run[] {
	if (typeof text === "string")
		return [
			{ text: text.normalize("NFC"), style: styles.style(cascade), link },
		];
	return text.map((span) =>
		typeof span === "string"
			? { text: span.normalize("NFC"), style: styles.style(cascade), link }
			: {
					text: span.text.normalize("NFC"),
					style: styles.style(styles.cascade(cascade, span)),
					link: span.link ?? link,
				},
	);
}

export function paragraphLines(
	styles: Styles,
	cascade: Cascade,
	paragraph: Paragraph,
	width: number,
): Line[] {
	return breakLines(
		runsOf(
			styles,
			styles.cascade(cascade, paragraph),
			paragraph.text,
			paragraph.link,
		),
		width,
	);
}

/** The height of lines or rows stacked one below the other. */
export const heightOf = (stacked: readonly { height: number }[]): number =>
	stacked.reduce((sum, item) => sum + item.height, 0);

/** Where something `size` wide starts within `width` from `x`, by its alignment. */
export function aligned(
	size: number,
	x: number,
	width: number,
	align: Align | undefined,
): number {
	if (align === "right") return x + width - size;
	if (align === "center") return x + (width - size) / 2;
	return x;
}

export const lineStart = (
	line: Line,
	x: number,
	width: number,
	align: Align | undefined,
): number => aligned(line.width, x, width, align);

/** Sets the lines down the flow, moving to a new page between lines. */
export async function placeLines(
	flow: Flow,
	lines: readonly Line[],
	align: Align | undefined,
): Promise<void> {
	for (const line of lines) {
		await flow.fit(line.height);
		flow.page.text(
			line,
			lineStart(line, flow.area.x, flow.area.width, align),
			flow.y,
		);
		flow.y += line.height;
	}
}
