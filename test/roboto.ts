import { readFileSync } from "node:fs";
import { type Family, font } from "../src/index.ts";

const fontFile = (name: string) =>
	readFileSync(new URL(`fonts/${name}.ttf`, import.meta.url));

/** Roboto, under the SIL Open Font License (test/fonts/OFL.txt). */
export function roboto(): Family {
	return {
		normal: font(fontFile("Roboto-Regular")),
		bold: font(fontFile("Roboto-Medium")),
		italic: font(fontFile("Roboto-Italic")),
		boldItalic: font(fontFile("Roboto-MediumItalic")),
	};
}
