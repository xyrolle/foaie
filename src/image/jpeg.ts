// A JPEG is embedded as it is: PDF readers decode it themselves (DCTDecode, ISO 32000-1, 7.4.8).
// Only its frame header is read, for the size and the colour components.

import { PdfError } from "../errors.ts";
import type { PdfImage } from "./image.ts";

const COLOR_SPACES: Record<number, string> = {
	1: "/DeviceGray",
	3: "/DeviceRGB",
	4: "/DeviceCMYK",
};

export function readJpeg(bytes: Uint8Array<ArrayBuffer>): PdfImage {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let adobe = false;
	let at = 2; // past the start-of-image marker
	while (at + 4 <= bytes.length) {
		if (view.getUint8(at) !== 0xff) break;
		const marker = view.getUint8(at + 1);
		if (marker === 0xff) {
			at++; // fill byte
			continue;
		}
		const length = view.getUint16(at + 2);
		if (marker === 0xee && isAdobe(view, at + 4)) adobe = true;
		if (isFrameHeader(marker)) {
			const height = view.getUint16(at + 5);
			const width = view.getUint16(at + 7);
			const components = view.getUint8(at + 9);
			const colorSpace = COLOR_SPACES[components];
			if (!colorSpace || width === 0 || height === 0) break;
			// Adobe's CMYK JPEGs store their ink inverted.
			const decode =
				components === 4 && adobe ? " /Decode [1 0 1 0 1 0 1 0]" : "";
			return {
				width,
				height,
				dictionary: `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode${decode}`,
				data: bytes,
			};
		}
		at += 2 + length;
	}
	throw new PdfError(
		"image-invalid",
		"The JPEG has no frame header foaie can read: check that the file isn't truncated.",
	);
}

/** The start-of-frame markers, which hold the image's size: every SOFn but DHT, JPG and DAC. */
function isFrameHeader(marker: number): boolean {
	return (
		marker >= 0xc0 &&
		marker <= 0xcf &&
		marker !== 0xc4 &&
		marker !== 0xc8 &&
		marker !== 0xcc
	);
}

function isAdobe(view: DataView, at: number): boolean {
	return [0x41, 0x64, 0x6f, 0x62, 0x65].every(
		(byte, i) => view.getUint8(at + i) === byte,
	);
}
