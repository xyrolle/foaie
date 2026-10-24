// The readers every rendered PDF is checked with: pdf.js, which must open it and extract its text,
// and qpdf, which must find no syntax or stream errors, where qpdf is installed.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

/** Each page's text as pdf.js extracts it: its items joined, a line break where pdf.js sees one. */
export async function pageTexts(pdf: Uint8Array): Promise<string[]> {
	const loading = getDocument({ data: pdf.slice(), verbosity: 0 });
	const document = await loading.promise;
	try {
		const pages: string[] = [];
		for (let number = 1; number <= document.numPages; number++) {
			const page = await document.getPage(number);
			const content = await page.getTextContent();
			let text = "";
			for (const item of content.items)
				if ("str" in item) text += item.str + (item.hasEOL ? "\n" : "");
			pages.push(text);
		}
		return pages;
	} finally {
		await loading.destroy();
	}
}

export const qpdfInstalled: boolean =
	spawnSync("qpdf", ["--version"]).status === 0;

/** qpdf's report on the file; it throws when qpdf finds an error. */
export function qpdfCheck(pdf: Uint8Array): string {
	const directory = mkdtempSync(join(tmpdir(), "foaie-"));
	try {
		const file = join(directory, "document.pdf");
		writeFileSync(file, pdf);
		return execFileSync("qpdf", ["--check", file]).toString();
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
