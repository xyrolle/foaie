// Breaking styled text into lines that fit a width: at spaces and after hyphens, never at a
// no-break space, and between characters only for a word wider than the line.

import type { Style } from "../layout/style.ts";
import { fittingLength, widthOf } from "./glyphs.ts";
import { tokens } from "./words.ts";

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

/**
 * How wide `runs` set with room to spare: their widest line, and their longest word, the narrowest
 * width they break into without splitting a word. A table's `auto` column is sized by these.
 */
export function naturalWidths(runs: readonly Run[]): {
	widest: number;
	longestWord: number;
} {
	let widest = 0;
	for (const line of breakLines(runs, Number.POSITIVE_INFINITY))
		widest = Math.max(widest, line.width);
	// A word runs on across runs, up to a space, a line break, or the hyphen it may break after.
	let longestWord = 0;
	let word = 0;
	for (const run of runs)
		for (const token of tokens(run.text)) {
			if (token === " " || token === "\n") {
				word = 0;
				continue;
			}
			word += measure({ ...run, text: token });
			longestWord = Math.max(longestWord, word);
			if (token.endsWith("-")) word = 0;
		}
	return { widest, longestWord };
}

class LineBreaker {
	readonly #width: number;
	readonly #lines: Line[] = [];
	#pieces: Piece[] = [];
	/** The pieces that joined several words or runs: measured whole at the line's end, kerning across them included. */
	readonly #joined = new Set<Piece>();
	#used = 0;
	/** The space waiting between the last word and the next: kept only if a word follows on this line. */
	#space: Run | undefined;
	/** The word being read: its text in each run it spans, with no break between them. */
	#word: Run[] = [];
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
				if (token === "\n") {
					this.#setWord();
					this.#endLine();
				} else if (token === " ") {
					this.#setWord();
					this.#space =
						this.#pieces.length > 0 ? { ...run, text: " " } : undefined;
				} else {
					// A line may break after a hyphen: the word ends there.
					if (this.#word.at(-1)?.text.endsWith("-")) this.#setWord();
					this.#word.push({ ...run, text: token });
				}
			}
		}
		this.#setWord();
		this.#endLine();
		return this.#lines;
	}

	/** Sets the word read so far after the waiting space, or on the next line when it doesn't fit. */
	#setWord(): void {
		const parts = this.#word;
		if (parts.length === 0) return;
		this.#word = [];
		const widths = parts.map(measure);
		const width = widths.reduce((sum, part) => sum + part, 0);
		const space = this.#space ? measure(this.#space) : 0;
		if (this.#pieces.length > 0 && this.#used + space + width > this.#width)
			this.#endLine();
		if (this.#space && this.#pieces.length > 0)
			this.#append(this.#space, space);
		this.#space = undefined;
		for (const [i, part] of parts.entries()) {
			const partWidth = widths[i] ?? 0;
			if (width <= this.#width) this.#append(part, partWidth);
			else this.#setPart(part, partWidth);
		}
	}

	/** Sets a part of a word wider than a whole line: on the next line, or broken between characters. */
	#setPart(part: Run, width: number): void {
		if (this.#pieces.length > 0 && this.#used + width > this.#width)
			this.#endLine();
		if (this.#pieces.length > 0 || width <= this.#width) {
			this.#append(part, width);
			return;
		}
		const rest = this.#breakWord(part);
		this.#append(rest, measure(rest));
	}

	/**
	 * Sets the full lines a word wider than the line breaks into, between its characters, and
	 * returns the part left for the next line.
	 */
	#breakWord(word: Run): Run {
		const { face } = word.style.use;
		const fitting = (text: string) =>
			fittingLength(face, text, word.style.size, this.#width);
		let rest = word.text;
		let length = fitting(rest);
		while (length < rest.length) {
			const part = { ...word, text: rest.slice(0, length) };
			this.#append(part, measure(part));
			this.#endLine();
			rest = rest.slice(length);
			length = fitting(rest);
		}
		return { ...word, text: rest };
	}

	#append(run: Run, width: number): void {
		const last = this.#pieces.at(-1);
		if (last && last.style === run.style && last.link === run.link) {
			last.text += run.text;
			last.width += width;
			this.#joined.add(last);
		} else this.#pieces.push({ ...run, width });
		this.#used += width;
	}

	#endLine(): void {
		for (const piece of this.#joined) piece.width = measure(piece);
		this.#joined.clear();
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
