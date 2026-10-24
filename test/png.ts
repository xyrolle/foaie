// PNG files built in the test that needs them: every colour type, bit depth and transparency the
// library reads, from one gradient.

import { crc32, deflateSync } from "node:zlib";

export type PngShape = {
	colorType: 0 | 2 | 3 | 4 | 6;
	depth: 8 | 16;
	transparency?: Uint8Array;
	interlaced?: boolean;
};

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as const;
const PALETTE = Uint8Array.from(
	{ length: 4 * 3 },
	(_, i) => [0, 85, 170, 255][Math.floor(i / 3)] ?? 0,
);

/** A `width` × `height` PNG of a diagonal gradient; a palette image indexes four greys. */
export function png(
	{ colorType, depth, transparency, interlaced = false }: PngShape,
	width = 16,
	height = 8,
): Uint8Array {
	const channels = CHANNELS[colorType];
	const size = depth / 8;
	const stride = width * channels * size;
	const samples = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++)
			for (let c = 0; c < channels; c++) {
				const value =
					colorType === 3
						? (x + y) % 4
						: Math.round(((x + y + c * 3) / (width + height + 9)) * 255);
				for (let b = 0; b < size; b++)
					samples[y * stride + (x * channels + c) * size + b] = value;
			}
	const raw = filterRows(samples, stride, height, Math.max(1, channels * size));
	const header = new Uint8Array(13);
	const view = new DataView(header.buffer);
	view.setUint32(0, width);
	view.setUint32(4, height);
	header.set([depth, colorType, 0, 0, interlaced ? 1 : 0], 8);
	return concat([
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		...(colorType === 3 ? [chunk("PLTE", PALETTE)] : []),
		...(transparency ? [chunk("tRNS", transparency)] : []),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", new Uint8Array()),
	]);
}

/** Each row filtered with the next of PNG's five filters in turn, so a reader must undo every one. */
function filterRows(
	samples: Uint8Array,
	stride: number,
	height: number,
	left: number,
): Uint8Array {
	const out = new Uint8Array((stride + 1) * height);
	const at = (y: number, i: number) =>
		y < 0 || i < 0 ? 0 : (samples[y * stride + i] ?? 0);
	for (let y = 0; y < height; y++) {
		const filter = y % 5;
		out[y * (stride + 1)] = filter;
		for (let i = 0; i < stride; i++) {
			const [x, a, b, c] = [
				at(y, i),
				at(y, i - left),
				at(y - 1, i),
				at(y - 1, i - left),
			];
			const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter] ?? 0;
			out[y * (stride + 1) + 1 + i] = (x - predicted) & 0xff;
		}
	}
	return out;
}

function paeth(a: number, b: number, c: number): number {
	const p = a + b - c;
	const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + body.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, body.length);
	out.set(new TextEncoder().encode(type), 4);
	out.set(body, 8);
	view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
	return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
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
