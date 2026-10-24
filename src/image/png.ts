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
/** Each colour type's channels, and the bit depths PNG allows it (PNG 3, 11.2.1). */
const COLOR_TYPES: Record<number, { channels: number; depths: number[] }> = {
	[GRAY]: { channels: 1, depths: [1, 2, 4, 8, 16] },
	[RGB]: { channels: 3, depths: [8, 16] },
	[PALETTE]: { channels: 1, depths: [1, 2, 4, 8] },
	[GRAY_ALPHA]: { channels: 2, depths: [8, 16] },
	[RGB_ALPHA]: { channels: 4, depths: [8, 16] },
};

/** A PNG foaie can't embed because its bytes are wrong: `problem` says how. */
const broken = (problem: string): PdfError =>
	new PdfError("image-invalid", `The PNG ${problem}. Save the image again.`);

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
		if (at + 12 + length > bytes.length)
			throw broken(`ends inside its ${type} chunk: the file is truncated`);
		const body = bytes.subarray(at + 8, at + 8 + length);
		if (type === "IHDR") header = readHeader(view, at + 8);
		else if (type === "PLTE") palette = body;
		else if (type === "tRNS") transparency = body;
		else if (type === "IDAT") data.push(body);
		else if (type === "IEND") break;
		at += 12 + length;
	}
	if (!header || data.length === 0)
		throw broken("has no header or no image data: the file is truncated");
	if (header.colorType === PALETTE && !isPalette(palette))
		throw broken("indexes a palette it holds no PLTE chunk for");
	return { header, palette, transparency, data: concat(data) };
}

function readHeader(view: DataView, at: number): Header {
	const depth = view.getUint8(at + 8);
	const colorType = view.getUint8(at + 9);
	const type = COLOR_TYPES[colorType];
	if (!type?.depths.includes(depth))
		throw broken(
			`has bit depth ${depth} with colour type ${colorType}, which PNG doesn't allow`,
		);
	const width = view.getUint32(at);
	const height = view.getUint32(at + 4);
	if (width === 0 || height === 0)
		throw broken(`is ${width} × ${height} pixels, which PNG doesn't allow`);
	return {
		width,
		height,
		depth,
		colorType,
		channels: type.channels,
		interlaced: view.getUint8(at + 12) === 1,
	};
}

/** A PLTE chunk's body: one to 256 RGB entries. */
const isPalette = (palette: Uint8Array) =>
	palette.length >= 3 && palette.length <= 768 && palette.length % 3 === 0;

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
