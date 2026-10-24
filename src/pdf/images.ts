// Image XObjects: each image a document places is written once, the first time a page draws it.

import type { Picture } from "../document.ts";
import { PdfError } from "../errors.ts";
import { type Image, pdfImageOf } from "../image/image.ts";
import type { Flow } from "../layout/flow.ts";
import { aligned } from "../layout/paragraph.ts";
import type { PdfWriter } from "./writer.ts";

/** Points per pixel when a picture gives no size: the CSS pixel, 96 to the inch. */
const POINTS_PER_PIXEL = 72 / 96;

export class ImageObjects {
	readonly #writer: PdfWriter;
	readonly #written = new Map<Image, { name: string; reference: number }>();

	constructor(writer: PdfWriter) {
		this.#writer = writer;
	}

	/** A picture's size in points: as given, else its pixels as CSS pixels, never wider than `available`. */
	sizeOf(
		picture: Picture,
		available: number,
	): { width: number; height: number } {
		const { width: pixelsWide, height: pixelsHigh } = picture.image;
		const ratio = pixelsHigh / pixelsWide;
		let width =
			picture.width ??
			(picture.height === undefined
				? pixelsWide * POINTS_PER_PIXEL
				: picture.height / ratio);
		if (picture.width === undefined && picture.height === undefined)
			width = Math.min(width, available);
		return { width, height: picture.height ?? width * ratio };
	}

	draw(flow: Flow, picture: Picture, width: number, height: number): void {
		const { name, reference } = this.#reference(picture.image);
		const x = aligned(width, flow.area.x, flow.area.width, picture.align);
		flow.page.image(reference, name, x, flow.y, width, height);
	}

	#reference(handle: Image): { name: string; reference: number } {
		let written = this.#written.get(handle);
		if (!written) {
			const image = pdfImageOf(handle);
			if (!image)
				throw new PdfError(
					"image-invalid",
					"A picture's image wasn't made by image(). Parse the image's bytes with image().",
				);
			const reference = this.#writer.reserve();
			let mask = "";
			if (image.mask) {
				const maskReference = this.#writer.reserve();
				this.#writer.stream(
					maskReference,
					`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ${image.mask.dictionary}`,
					image.mask.data,
				);
				mask = ` /SMask ${maskReference} 0 R`;
			}
			this.#writer.stream(
				reference,
				`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} ${image.dictionary}${mask}`,
				image.data,
			);
			written = { name: `I${this.#written.size + 1}`, reference };
			this.#written.set(handle, written);
		}
		return written;
	}
}
