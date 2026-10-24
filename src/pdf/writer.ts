// The PDF file itself: numbered objects written as they are ready, then the cross-reference table
// that says where each one starts (ISO 32000-1, 7.5).

import { deflate } from "../deflate.ts";

const encoder = new TextEncoder();
/** The header, and a comment of four bytes above 127 that tells transfer tools the file is binary. */
const HEADER = new Uint8Array([
	...encoder.encode("%PDF-1.7\n%"),
	0xe2,
	0xe3,
	0xcf,
	0xd3,
	0x0a,
]);

/** Streams compressed at once, at most: pages are laid out while the ones before them compress. */
const COMPRESSING = 8;
/** Below this many bytes a stream is written as it is: deflating it costs more than it saves. */
const WORTH_COMPRESSING = 1024;

export class PdfWriter {
	readonly #chunks: Uint8Array[] = [HEADER];
	#size = HEADER.length;
	/** Where each object starts, by its number minus one; -1 until it is written. */
	readonly #offsets: number[] = [];
	/** Objects are written in the order they are given, whenever their streams finish compressing. */
	#written: Promise<void> = Promise.resolve();
	readonly #compressing: Promise<void>[] = [];

	/** A number for an object that will be written later. */
	reserve(): number {
		this.#offsets.push(-1);
		return this.#offsets.length;
	}

	object(reference: number, body: string): void {
		this.#inOrder(() => this.#object(reference, body));
	}

	/** A stream object; `dictionary` holds every entry but its length. */
	stream(reference: number, dictionary: string, data: Uint8Array): void {
		this.#inOrder(() => this.#stream(reference, dictionary, data));
	}

	/**
	 * A stream object, compressed with FlateDecode when that is worth it. It compresses while the
	 * caller goes on, and the promise settles once few enough streams are left compressing to take
	 * another.
	 */
	async compressed(
		reference: number,
		dictionary: string,
		data: string | Uint8Array<ArrayBuffer>,
	): Promise<void> {
		const bytes = typeof data === "string" ? encoder.encode(data) : data;
		if (bytes.length < WORTH_COMPRESSING)
			return this.stream(reference, dictionary.trim(), bytes);
		const compressing = deflate(bytes);
		const entries = `${dictionary} /Filter /FlateDecode`.trim();
		const written = Promise.all([this.#written, compressing]).then(
			([, deflated]) => this.#stream(reference, entries, deflated),
		);
		this.#written = written;
		this.#compressing.push(written);
		if (this.#compressing.length > COMPRESSING) await this.#compressing.shift();
	}

	/** The file: every object, then the cross-reference table and the trailer naming its root. */
	async finish(trailer: string): Promise<Uint8Array> {
		await this.#written;
		const unwritten = this.#offsets.indexOf(-1);
		if (unwritten >= 0)
			throw new Error(
				`foaie reserved object ${unwritten + 1} and never wrote it`,
			);
		const start = this.#size;
		const entries = this.#offsets
			.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
			.join("");
		const count = this.#offsets.length + 1;
		this.#emit(
			encoder.encode(
				`xref\n0 ${count}\n0000000000 65535 f \n${entries}trailer\n<< /Size ${count} ${trailer} >>\nstartxref\n${start}\n%%EOF\n`,
			),
		);
		const file = new Uint8Array(this.#size);
		let at = 0;
		for (const chunk of this.#chunks) {
			file.set(chunk, at);
			at += chunk.length;
		}
		return file;
	}

	#inOrder(write: () => void): void {
		this.#written = this.#written.then(write);
	}

	#object(reference: number, body: string): void {
		this.#start(reference);
		this.#emit(encoder.encode(`${reference} 0 obj\n${body}\nendobj\n`));
	}

	#stream(reference: number, dictionary: string, data: Uint8Array): void {
		this.#start(reference);
		this.#emit(
			encoder.encode(
				`${reference} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`,
			),
		);
		this.#emit(data);
		this.#emit(encoder.encode("\nendstream\nendobj\n"));
	}

	#start(reference: number): void {
		this.#offsets[reference - 1] = this.#size;
	}

	#emit(chunk: Uint8Array): void {
		this.#chunks.push(chunk);
		this.#size += chunk.length;
	}
}

/** Text in a PDF text string: UTF-16BE with its byte order mark, as hex (ISO 32000-1, 7.9.2.2). */
export function textString(text: string): string {
	let hex = "<FEFF";
	for (let i = 0; i < text.length; i++)
		hex += text.charCodeAt(i).toString(16).padStart(4, "0");
	return `${hex}>`;
}

/** A URI as the ASCII string a URI action holds: other characters percent-encoded (ISO 32000-1, 12.6.4.7). */
export function uriString(uri: string): string {
	const ascii = uri.replace(/[^\x20-\x7e]/gu, (character) =>
		encodeURIComponent(character),
	);
	return `(${ascii.replace(/[\\()]/g, (special) => `\\${special}`)})`;
}

/** A date as PDF writes one, in UTC: D:YYYYMMDDHHmmSSZ (ISO 32000-1, 7.9.4). */
export function pdfDate(date: Date): string {
	const two = (n: number) => String(n).padStart(2, "0");
	return `(D:${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}Z)`;
}
