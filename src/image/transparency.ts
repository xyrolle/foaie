// A PNG with transparency, decoded once: inflated, its filters undone, and its alpha split from its
// colour, as a PDF image and its soft mask hold them (ISO 32000-1, 11.6.5.3).
// https://www.w3.org/TR/png-3/#9Filters

import { inflate } from "../deflate.ts";
import type { Header } from "./png.ts";

/** The image's colour samples, and the alpha its soft mask draws them through. */
export type Split = {
	color: Uint8Array<ArrayBuffer>;
	alpha: Uint8Array<ArrayBuffer>;
};

/** A PNG's samples, decoded: its image data inflated and its filters undone. */
export async function decode(
	data: Uint8Array<ArrayBuffer>,
	header: Header,
): Promise<Uint8Array<ArrayBuffer>> {
	return unfilter(await inflate(data), header);
}

/** Undoes PNG's per-row filters, leaving the raw samples row after row. */
function unfilter(
	filtered: Uint8Array,
	{ width, height, depth, channels }: Header,
): Uint8Array<ArrayBuffer> {
	const bitsPerPixel = channels * depth;
	const stride = Math.ceil((width * bitsPerPixel) / 8);
	const left = Math.max(1, bitsPerPixel / 8); // the byte distance to the same sample one pixel back
	const out = new Uint8Array(stride * height);
	for (let row = 0; row < height; row++) {
		const filter = filtered[row * (stride + 1)] ?? 0;
		const input = row * (stride + 1) + 1;
		const at = row * stride;
		for (let i = 0; i < stride; i++) {
			const a = i >= left ? (out[at + i - left] ?? 0) : 0;
			const b = row > 0 ? (out[at + i - stride] ?? 0) : 0;
			const c = i >= left && row > 0 ? (out[at + i - left - stride] ?? 0) : 0;
			const x = filtered[input + i] ?? 0;
			out[at + i] = (x + predictor(filter, a, b, c)) & 0xff;
		}
	}
	return out;
}

function predictor(filter: number, a: number, b: number, c: number): number {
	if (filter === 1) return a;
	if (filter === 2) return b;
	if (filter === 3) return (a + b) >> 1;
	if (filter === 4) {
		const p = a + b - c;
		const pa = Math.abs(p - a);
		const pb = Math.abs(p - b);
		const pc = Math.abs(p - c);
		return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
	}
	return 0;
}

/** Grey or RGB samples apart from their alpha, at 8 or 16 bits. */
export function splitAlpha(
	pixels: Uint8Array,
	{ width, height, depth, channels }: Header,
): Split {
	const size = depth / 8;
	const colors = channels - 1;
	const color = new Uint8Array(width * height * colors * size);
	const alpha = new Uint8Array(width * height * size);
	const pixel = channels * size;
	for (let p = 0, c = 0, a = 0; p < pixels.length; p += pixel) {
		for (let k = 0; k < colors * size; k++) color[c++] = pixels[p + k] ?? 0;
		for (let k = 0; k < size; k++)
			alpha[a++] = pixels[p + colors * size + k] ?? 0;
	}
	return { color, alpha };
}

/** A palette image's own indices, and an 8-bit alpha for each pixel from the palette's tRNS. */
export function paletteAlpha(
	pixels: Uint8Array<ArrayBuffer>,
	{ width, height, depth }: Header,
	transparency: Uint8Array,
): Split {
	const stride = Math.ceil((width * depth) / 8);
	const alpha = new Uint8Array(width * height);
	const mask = (1 << depth) - 1;
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const bit = x * depth;
			const index =
				((pixels[y * stride + (bit >> 3)] ?? 0) >> (8 - depth - (bit & 7))) &
				mask;
			alpha[y * width + x] = transparency[index] ?? 255;
		}
	return { color: pixels, alpha };
}
