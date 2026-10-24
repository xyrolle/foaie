// A PNG becomes a PDF image without being decoded when it has no transparency: its compressed data
// is already FlateDecode with PNG predictors (ISO 32000-1, 7.4.4.4). Transparency needs one decode,
// to split the alpha into a soft mask. https://www.w3.org/TR/png-3/

import { deflate, inflate } from "../deflate.ts";
import { PdfError } from "../errors.ts";
import type { PdfImage } from "./image.ts";

type Header = {
	width: number;
	height: number;
	depth: number;
	colorType: number;
	interlaced: boolean;
};

const GRAY = 0;
const RGB = 2;
const PALETTE = 3;
const GRAY_ALPHA = 4;
const RGB_ALPHA = 6;
const CHANNELS: Record<number, number> = {
	[GRAY]: 1,
	[RGB]: 3,
	[PALETTE]: 1,
	[GRAY_ALPHA]: 2,
	[RGB_ALPHA]: 4,
};

export async function readPng(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<PdfImage> {
	const { header, palette, transparency, data } = chunks(bytes);
	const { width, height, depth, colorType } = header;
	if (header.interlaced)
		throw new PdfError(
			"image-format",
			"The PNG is interlaced, which foaie doesn't decode. Save it again without interlacing.",
		);
	const colors = colorType === RGB || colorType === RGB_ALPHA ? 3 : 1;
	const colorSpace =
		colorType === PALETTE
			? `[/Indexed /DeviceRGB ${palette.length / 3 - 1} <${hex(palette)}>]`
			: colors === 3
				? "/DeviceRGB"
				: "/DeviceGray";
	const predicted = (channels: number) =>
		`/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${channels} /BitsPerComponent ${depth} /Columns ${width} >>`;

	const hasAlpha = colorType === GRAY_ALPHA || colorType === RGB_ALPHA;
	if (!hasAlpha && !(colorType === PALETTE && transparency)) {
		// A single transparent colour, for grey and RGB, is a colour key mask: still no decoding.
		const key = transparency && colorKey(transparency, colors);
		return {
			width,
			height,
			dictionary: `/ColorSpace ${colorSpace} /BitsPerComponent ${depth} ${predicted(colors)}${key ? ` /Mask [${key}]` : ""}`,
			data,
		};
	}

	const pixels = unfilter(await inflate(data), header);
	const { color, alpha } = hasAlpha
		? splitAlpha(pixels, header, colors)
		: paletteAlpha(pixels, header, transparency ?? new Uint8Array());
	return {
		width,
		height,
		dictionary: `/ColorSpace ${colorSpace} /BitsPerComponent ${depth} /Filter /FlateDecode`,
		data: await deflate(color),
		mask: {
			dictionary: `/ColorSpace /DeviceGray /BitsPerComponent ${hasAlpha ? depth : 8} /Filter /FlateDecode`,
			data: await deflate(alpha),
		},
	};
}

function chunks(bytes: Uint8Array<ArrayBuffer>) {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let header: Header | undefined;
	let palette = new Uint8Array();
	let transparency: Uint8Array | undefined;
	const data: Uint8Array[] = [];
	for (let at = 8; at + 8 <= bytes.length; ) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
		const body = bytes.subarray(at + 8, at + 8 + length);
		if (type === "IHDR")
			header = {
				width: view.getUint32(at + 8),
				height: view.getUint32(at + 12),
				depth: view.getUint8(at + 16),
				colorType: view.getUint8(at + 17),
				interlaced: view.getUint8(at + 20) === 1,
			};
		else if (type === "PLTE") palette = body;
		else if (type === "tRNS") transparency = body;
		else if (type === "IDAT") data.push(body);
		else if (type === "IEND") break;
		at += 12 + length;
	}
	if (!header || CHANNELS[header.colorType] === undefined || data.length === 0)
		throw new PdfError(
			"image-invalid",
			"The PNG has no header or no image data foaie can read: check that the file isn't truncated.",
		);
	return { header, palette, transparency, data: concat(data) };
}

/** Undoes PNG's per-row filters, leaving the raw samples row after row. */
function unfilter(
	filtered: Uint8Array,
	{ width, height, depth, colorType }: Header,
): Uint8Array<ArrayBuffer> {
	const bitsPerPixel = (CHANNELS[colorType] ?? 1) * depth;
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
function splitAlpha(
	pixels: Uint8Array,
	{ width, height, depth }: Header,
	colors: number,
) {
	const size = depth / 8;
	const color = new Uint8Array(width * height * colors * size);
	const alpha = new Uint8Array(width * height * size);
	const pixel = (colors + 1) * size;
	for (let p = 0, c = 0, a = 0; p < pixels.length; p += pixel) {
		for (let k = 0; k < colors * size; k++) color[c++] = pixels[p + k] ?? 0;
		for (let k = 0; k < size; k++)
			alpha[a++] = pixels[p + colors * size + k] ?? 0;
	}
	return { color, alpha };
}

/** A palette image's own indices, and an 8-bit alpha for each pixel from the palette's tRNS. */
function paletteAlpha(
	pixels: Uint8Array<ArrayBuffer>,
	{ width, height, depth }: Header,
	transparency: Uint8Array,
) {
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

/** The tRNS colour as a mask range: each channel's value twice. */
function colorKey(transparency: Uint8Array, colors: number): string {
	const view = new DataView(
		transparency.buffer,
		transparency.byteOffset,
		transparency.byteLength,
	);
	const values = Array.from({ length: colors }, (_, i) =>
		view.getUint16(2 * i),
	);
	return values.map((value) => `${value} ${value}`).join(" ");
}

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const out = new Uint8Array(
		parts.reduce((size, part) => size + part.length, 0),
	);
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}
