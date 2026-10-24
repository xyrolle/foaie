// A PNG becomes a PDF image without being decoded when it has no transparency: its compressed data
// is already FlateDecode with PNG predictors (ISO 32000-1, 7.4.4.4). Transparency needs one decode,
// to split the alpha into a soft mask. https://www.w3.org/TR/png-3/

import { deflate } from "../deflate.ts";
import { PdfError } from "../errors.ts";
import type { PdfImage } from "./image.ts";
import { decode, paletteAlpha, splitAlpha } from "./transparency.ts";

/** The image header (IHDR), with the channels its colour type has. */
export type Header = {
	width: number;
	height: number;
	depth: number;
	colorType: number;
	channels: number;
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

	const pixels = await decode(data, header);
	const { color, alpha } = hasAlpha
		? splitAlpha(pixels, header)
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
		if (type === "IHDR") {
			const colorType = view.getUint8(at + 17);
			header = {
				width: view.getUint32(at + 8),
				height: view.getUint32(at + 12),
				depth: view.getUint8(at + 16),
				colorType,
				channels: CHANNELS[colorType] ?? 0,
				interlaced: view.getUint8(at + 20) === 1,
			};
		} else if (type === "PLTE") palette = body;
		else if (type === "tRNS") transparency = body;
		else if (type === "IDAT") data.push(body);
		else if (type === "IEND") break;
		at += 12 + length;
	}
	if (!header || header.channels === 0 || data.length === 0)
		throw new PdfError(
			"image-invalid",
			"The PNG has no header or no image data foaie can read: check that the file isn't truncated.",
		);
	return { header, palette, transparency, data: concat(data) };
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
