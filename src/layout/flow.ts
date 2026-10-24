// The flow of blocks down a page's body, and on to the next page.

import { PdfError } from "../errors.ts";
import type { PageContent } from "./page.ts";

/** Where blocks are laid out on every page, in points from the page's top-left corner. */
export type Area = { x: number; top: number; width: number; bottom: number };

export class Flow {
	readonly area: Area;
	page: PageContent;
	/** Where the next block starts. */
	y: number;
	readonly #next: (() => Promise<PageContent>) | undefined;

	/** A flow that moves on to `next()`'s page when one fills up; without `next`, it can't. */
	constructor(
		area: Area,
		page: PageContent,
		next?: () => Promise<PageContent>,
	) {
		this.area = area;
		this.page = page;
		this.y = area.top;
		this.#next = next;
	}

	/** The height left on this page. */
	get room(): number {
		return this.area.bottom - this.y;
	}

	/** The height of a whole page's body. */
	get pageHeight(): number {
		return this.area.bottom - this.area.top;
	}

	/** Whether nothing has been placed on this page yet: moving on wouldn't give more room. */
	get atTop(): boolean {
		return this.y === this.area.top;
	}

	/**
	 * Makes room for `height`, moving to the next page unless this one has it or is still empty.
	 * Only a line can be taller than a whole page's body: pictures are scaled down to fit one, and
	 * tables split between lines.
	 */
	async fit(height: number): Promise<void> {
		if (height <= this.room) return;
		if (!this.#next) throw tooTall();
		if (height > this.pageHeight)
			throw pageTooSmall(
				`A line is ${Math.ceil(height)} points tall, and the page's body only ${Math.floor(this.pageHeight)}. Make its text smaller, or the page larger or its margins narrower.`,
			);
		if (!this.atTop) await this.newPage();
	}

	async newPage(): Promise<void> {
		if (!this.#next) throw tooTall();
		this.page = await this.#next();
		this.y = this.area.top;
	}
}

/** Content that no page can hold: `message` says what, and how to make it fit. */
export function pageTooSmall(message: string): PdfError {
	return new PdfError("page-too-small", message);
}

/** A decoration's flow has one page: what doesn't fit its margin can't move on. */
function tooTall(): PdfError {
	return new PdfError(
		"decoration-too-tall",
		"A header or footer is taller than its margin. Make the margin taller, or the header or footer shorter.",
	);
}
