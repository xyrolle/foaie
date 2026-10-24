// Where text may break: the words a line breaker sets, the spaces between them and the line breaks.

/**
 * Words (each with the hyphen it may break after), single spaces and line breaks. A tab reads as a
 * space, and a carriage return as a line break, or as part of the one it comes before.
 */
export function* tokens(text: string): Generator<string> {
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
