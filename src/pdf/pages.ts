// The document's structure: each page's dictionary with its resources and links, the page tree,
// the catalog and the information dictionary (ISO 32000-1, 7.7 and 14.3.3).

import type { Document } from "../document.ts";
import type { PageContent } from "../layout/page.ts";
import type { FaceUse } from "../layout/style.ts";
import { decimal as d } from "../layout/style.ts";
import { type PdfWriter, pdfDate, textString, uriString } from "./writer.ts";

/** The texts of the information dictionary, by their keys in a definition (ISO 32000-1, 14.3.3). */
const INFO_TEXTS = [
	["title", "Title"],
	["author", "Author"],
	["subject", "Subject"],
	["keywords", "Keywords"],
	["creator", "Creator"],
] as const;

/** A page once its content is written: what it drew, and its content streams. */
export type WrittenPage = { content: PageContent; streams: number[] };

type Shared = {
	size: readonly [number, number];
	fonts: Map<FaceUse, number>;
	/** The translucent graphics state the watermark draws through, if there is one. */
	translucency: number | undefined;
};

/** Writes every page and the page tree over them, and returns the tree's object number. */
export function writePages(
	writer: PdfWriter,
	pages: readonly WrittenPage[],
	shared: Shared,
): number {
	const tree = writer.reserve();
	const kids = pages.map(
		(page) => `${writePage(writer, page, tree, shared)} 0 R`,
	);
	writer.object(
		tree,
		`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`,
	);
	return tree;
}

function writePage(
	writer: PdfWriter,
	{ content, streams }: WrittenPage,
	tree: number,
	{ size, fonts, translucency }: Shared,
): number {
	const reference = writer.reserve();
	const font = [...content.fonts]
		.map((use) => `/${use.resource} ${fonts.get(use)} 0 R`)
		.join(" ");
	const image = [...content.images]
		.map(([name, object]) => `/${name} ${object} 0 R`)
		.join(" ");
	const resources = [
		font && `/Font << ${font} >>`,
		image && `/XObject << ${image} >>`,
		content.translucent && translucency
			? `/ExtGState << /W1 ${translucency} 0 R >>`
			: "",
	].filter((entry) => entry !== "");
	const links = content.links.map((link) => {
		const annotation = writer.reserve();
		writer.object(
			annotation,
			`<< /Type /Annot /Subtype /Link /Rect [${link.rect.map(d).join(" ")}] /Border [0 0 0] /A << /S /URI /URI ${uriString(link.url)} >> >>`,
		);
		return `${annotation} 0 R`;
	});
	const annotations = links.length ? ` /Annots [${links.join(" ")}]` : "";
	writer.object(
		reference,
		`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${size.map(d).join(" ")}] /Resources << ${resources.join(" ")} >> /Contents [${streams.map((s) => `${s} 0 R`).join(" ")}]${annotations} >>`,
	);
	return reference;
}

/** Writes the catalog and the information dictionary, and returns the trailer's entries. */
export function writeCatalog(
	writer: PdfWriter,
	tree: number,
	document: Document,
): string {
	const catalog = writer.reserve();
	const lang = document.lang ? ` /Lang ${textString(document.lang)}` : "";
	writer.object(catalog, `<< /Type /Catalog /Pages ${tree} 0 R${lang} >>`);
	const root = `/Root ${catalog} 0 R`;
	const { info = {} } = document;
	const entries: string[] = [];
	for (const [key, name] of INFO_TEXTS) {
		const value = info[key];
		if (value !== undefined) entries.push(`/${name} ${textString(value)}`);
	}
	if (info.created) entries.push(`/CreationDate ${pdfDate(info.created)}`);
	if (entries.length === 0) return root;
	const dictionary = writer.reserve();
	writer.object(dictionary, `<< ${entries.join(" ")} >>`);
	return `${root} /Info ${dictionary} 0 R`;
}
