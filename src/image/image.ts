import { PdfError } from "../errors.ts";
import { readJpeg } from "./jpeg.ts";
import { readPng } from "./png.ts";

/** A parsed image, made by `image()` and placed by any number of renders. */
export interface Image {
	/** The width in pixels. */
	readonly width: number;
	/** The height in pixels. */
	readonly height: number;
}

/** An image as a PDF image XObject holds it: its dictionary's entries and its data, and a soft mask. */
export type PdfImage = {
	width: number;
	height: number;
	dictionary: string;
	data: Uint8Array<ArrayBuffer>;
	mask?: { dictionary: string; data: Uint8Array<ArrayBuffer> };
};

const parsed = new WeakMap<Image, PdfImage>();

/**
 * Parses a JPEG or PNG once, for every render that places it.
 * Throws `image-format` for other formats and interlaced PNGs, and `image-invalid` for broken bytes.
 */
export async function image(data: Uint8Array | ArrayBuffer): Promise<Image> {
	const bytes = new Uint8Array(data);
	let pdfImage: PdfImage;
	try {
		pdfImage = await read(bytes);
	} catch (error) {
		// A truncated or corrupt file runs a read past its end.
		if (error instanceof RangeError)
			throw new PdfError(
				"image-invalid",
				"The image's bytes are broken: they end before the image does.",
				{ cause: error },
			);
		throw error;
	}
	const handle: Image = Object.freeze({
		width: pdfImage.width,
		height: pdfImage.height,
	});
	parsed.set(handle, pdfImage);
	return handle;
}

function read(bytes: Uint8Array<ArrayBuffer>): PdfImage | Promise<PdfImage> {
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return readJpeg(bytes);
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	)
		return readPng(bytes);
	throw new PdfError(
		"image-format",
		"foaie places JPEG and PNG images, and this is neither. Convert it to PNG or JPEG.",
	);
}

/** The parsed image behind a handle `image()` returned. */
export function pdfImageOf(handle: Image): PdfImage | undefined {
	return parsed.get(handle);
}
