// Breaking styled text into lines that fit a width: at spaces and after hyphens, never at a
// no-break space, and between characters only for a word wider than the line.

import type { Style } from "../layout/style.ts";
import { widthOf } from "./glyphs.ts";

/** Text in one style, as a paragraph or a cell is made of. */
export type Run = { text: string; style: Style; link: string | undefined };

/** Part of a line in one style; its width in points. */
export type Piece = Run & { width: number };

export type Line = {
	pieces: Piece[];
	width: number;
	/** From the line's top to its baseline, and from its top to the next line's top. */
	ascent: number;
	height: number;
};

/** What keeps text from being set as it is: a line break or a tab, or spaces to set as one or to drop. */
const UNSET = /[\n\r\t]|^ | $| {2}/;

/**
 * The lines of `runs` within `width` points. A paragraph that is all one style and fits on one line
 * as it is takes the short path.
 */
export function breakLines(runs: readonly Run[], width: number): Line[] {
	const only = runs.length === 1 ? runs[0] : undefined;
	if (only && !UNSET.test(only.text)) {
		const textWidth = widthOf(only.style.use.face, only.text, only.style.size);
		if (textWidth <= width)
			return [lineOf([{ ...only, width: textWidth }], only.style)];
	}
	return new LineBreaker(width, runs[0]?.style).run(runs);
}

class LineBreaker {
	readonly #width: number;
	readonly #lines: Line[] = [];
	#pieces: Piece[] = [];
	#used = 0;
	/** The space waiting between the last word and the next: kept only if a word follows on this line. */
	#space: Run | undefined;
	/** The style of an empty line, from the text around it. */
	#style: Style | undefined;

	constructor(width: number, style: Style | undefined) {
		this.#width = width;
		this.#style = style;
	}

	run(runs: readonly Run[]): Line[] {
		for (const run of runs) {
			this.#style = run.style;
			for (const token of tokens(run.text)) {
				if (token === "\n") this.#endLine();
				else if (token === " ")
					this.#space =
						this.#pieces.length > 0 ? { ...run, text: " " } : undefined;
				else this.#word({ ...run, text: token });
			}
		}
		this.#endLine();
		return this.#lines;
	}

	#word(word: Run): void {
		const space = this.#space ? measure(this.#space) : 0;
		let width = measure(word);
		if (this.#pieces.length > 0 && this.#used + space + width > this.#width)
			this.#endLine();
		// A word wider than a whole line breaks between its characters.
		while (
			this.#pieces.length === 0 &&
			width > this.#width &&
			[...word.text].length > 1
		) {
			const fit = longestFit(word, this.#width);
			this.#append(fit, measure(fit));
			this.#endLine();
			word = { ...word, text: word.text.slice(fit.text.length) };
			width = measure(word);
		}
		if (this.#space && this.#pieces.length > 0)
			this.#append(this.#space, space);
		this.#space = undefined;
		this.#append(word, width);
	}

	#append(run: Run, width: number): void {
		const last = this.#pieces.at(-1);
		if (last && last.style === run.style && last.link === run.link) {
			last.text += run.text;
			last.width += width;
		} else this.#pieces.push({ ...run, width });
		this.#used += width;
	}

	#endLine(): void {
		// A piece that joined several words is measured whole, so kerning across them counts.
		for (const piece of this.#pieces)
			if (piece.text.includes(" ")) piece.width = measure(piece);
		const style = this.#pieces[0]?.style ?? this.#style;
		if (style) this.#lines.push(lineOf(this.#pieces, style));
		this.#pieces = [];
		this.#used = 0;
		this.#space = undefined;
	}
}

function lineOf(pieces: Piece[], style: Style): Line {
	let ascent = style.ascent;
	let height = style.lineHeight;
	let width = 0;
	for (const piece of pieces) {
		ascent = Math.max(ascent, piece.style.ascent);
		height = Math.max(height, piece.style.lineHeight);
		width += piece.width;
	}
	return { pieces, width, ascent, height };
}

const measure = (run: Run) =>
	widthOf(run.style.use.face, run.text, run.style.size);

/**
 * Words (each with the hyphen it may break after), single spaces and line breaks. A tab reads as a
 * space, and a carriage return as a line break, or as part of the one it comes before.
 */
function* tokens(text: string): Generator<string> {
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		const reads =
			char === " " || char === "\t"
				? " "
				: char === "\n" || char === "\r"
					? "\n"
					: undefined;
		if (reads) {
			if (i > start) yield text.slice(start, i);
			if (!(char === "\r" && text[i + 1] === "\n")) yield reads;
			start = i + 1;
		} else if (char === "-" && i > start) {
			yield text.slice(start, i + 1);
			start = i + 1;
		}
	}
	if (start < text.length) yield text.slice(start);
}

/** The longest start of `word` that fits `width`, at least one character. */
function longestFit(word: Run, width: number): Run {
	const characters = [...word.text];
	let count = characters.length - 1;
	while (
		count > 1 &&
		measure({ ...word, text: characters.slice(0, count).join("") }) > width
	)
		count--;
	return { ...word, text: characters.slice(0, count).join("") };
}
