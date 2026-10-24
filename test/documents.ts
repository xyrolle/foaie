// The reference documents the tests, the conformance suite and the benchmark render: a one-page A5
// invoice, an A4 price list and a long landscape ledger, in their typical and largest forms.

import { type Block, type Document, type Family, mm } from "../src/index.ts";

/** Names as people type them, in the scripts the library promises to set. */
export const NAMES: readonly string[] = [
	"Ana-Maria Țăranu",
	"Дмитрий Иванов",
	"Σοφία Παππά",
	"Nguyễn Thị Lan",
	"Zoë Ørsted",
	"Łucja Wiśniewska",
	"Ömer Çelik",
	"Јован Петровић",
	"Ingrid Ångström",
	"Ștefan Lupu",
];
const name = (i: number) => NAMES[i % NAMES.length] ?? "";

const money = (cents: number) =>
	`${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} EUR`;
const MUTED = "#555";

/** A one-page A5 invoice: label/value rows and a totals table. The largest has 60 lines and runs to 3 pages. */
export function invoice(family: Family, size: "typical" | "largest"): Document {
	const largest = size === "largest";
	const lines = Array.from({ length: largest ? 60 : 1 }, (_, i) => ({
		text: `Workshop session ${i + 1} · ${name(i)}`,
		amount: 30_000 + i * 100,
	}));
	const total = lines.reduce((sum, line) => sum + line.amount, 0);
	const amount = (cents: number, bold = false) => ({
		text: money(cents),
		align: "right" as const,
		bold,
	});
	const content: Block[] = [
		{
			text: [
				"Example Studio Ltd",
				"VAT 0123456789",
				`${name(3)} Street 1, Springfield`,
			].join("\n"),
			size: 9,
			color: MUTED,
		},
		{
			text: `Invoice ${largest ? "2026-1234" : "2026-0007"}`,
			bold: true,
			size: 14,
			spaceBefore: 12,
			spaceAfter: 2,
		},
		{ text: "12 March 2026", color: MUTED, spaceAfter: 12 },
		{
			table: {
				widths: [90, "*"],
				padding: 0,
				rows: [
					[
						{ text: "Billed to", color: MUTED },
						{ text: name(4), bold: true },
					],
				],
			},
			spaceAfter: 8,
		},
		{
			table: {
				widths: ["*", "auto"],
				borders: "rows",
				borderColor: "#aaa",
				rows: [
					...lines.map((line) => [line.text, amount(line.amount)]),
					[{ text: "Total", bold: true }, amount(total, true)],
				],
			},
			spaceAfter: 12,
		},
	];
	if (largest)
		content.push({ text: NAMES.join(", "), italic: true, spaceAfter: 12 });
	content.push({
		table: {
			widths: [90, "*"],
			padding: 0,
			rows: [[{ text: "Issued by", color: MUTED }, name(7)]],
		},
	});
	return {
		page: { size: "A5", margin: 36 },
		fonts: { Roboto: family },
		style: { font: "Roboto", size: 10 },
		content,
		info: { title: "Invoice" },
	};
}

/** An A4 price list: a table of 14 or 120 rows with a header. */
export function priceList(family: Family, rows: number): Document {
	const items = Array.from({ length: rows }, (_, i) => [
		`Item ${i + 1}. ${i % 2 ? "Maintenance of equipment, parts and labour included" : "Consultation and written report"}`,
		i % 2 ? "Service" : "Advice",
		{ text: String(2 + (i % 5)), align: "right" as const },
	]);
	const bold = (text: string) => ({ text, bold: true });
	return {
		page: { size: "A4", margin: 40 },
		fonts: { Roboto: family },
		style: { font: "Roboto", size: 10 },
		content: [
			{ text: "Price list", bold: true, size: 16, spaceAfter: 4 },
			{ text: "Valid from 1 January 2026", color: MUTED, spaceAfter: 12 },
			{
				table: {
					widths: ["*", "auto", "auto"],
					borders: "rows",
					borderColor: "#aaa",
					header: [[bold("Item"), bold("Kind"), bold("Hours")]],
					rows: items,
				},
			},
		],
	};
}

const CATEGORIES = [
	"Received",
	"Dispatched",
	"Increase",
	"Decrease",
	"Transformed",
	"Disposed",
];

/** A landscape ledger of 16 columns with group bands, subtotals, a page footer and a watermark. */
export function ledger(family: Family, rows: number): Document {
	const columns: [string, "left" | "right", number | "*"][] = [
		["Date", "left", 15],
		["Category", "left", 15],
		["Operation", "left", 24],
		["Kind", "left", 14],
		["Name", "left", 24],
		["In", "right", 14],
		["Out", "right", 14],
		["Weight in", "right", 14],
		["Weight out", "right", 14],
		["Material", "left", 18],
		["Qty", "right", 10],
		["Unit", "left", 8],
		["Batch", "left", 16],
		["Document", "left", 16],
		["Responsible", "left", 18],
		["Notes", "left", "*"],
	];
	const header = [
		columns.map(([text]) => ({ text, bold: true, fill: "#e8e8e8" as const })),
	];
	const body = [];
	const perCategory = Math.ceil(rows / CATEGORIES.length);
	let n = 0;
	for (const category of CATEGORIES) {
		body.push([
			{
				text: category,
				colSpan: columns.length,
				bold: true,
				fill: "#eee" as const,
			},
		]);
		let sum = 0;
		for (let i = 0; i < perCategory && n < rows; i++, n++) {
			const volume = ((n * 37) % 900) + 10;
			sum += volume;
			const cells = [
				`2026-${String(1 + (n % 12)).padStart(2, "0")}-${String(1 + (n % 28)).padStart(2, "0")}`,
				category,
				["Intake", "Transfer", "Assembly", "Packing", "Inspection"][n % 5] ??
					"",
				"Part",
				`Part ${2020 + (n % 6)}/${n}`,
				volume.toFixed(2),
				"",
				n % 7 ? "" : String(volume * 12),
				"",
				n % 3 ? "" : "Packaging film",
				n % 3 ? "" : "4.50",
				n % 3 ? "" : "kg",
				n % 3 ? "" : `B-${1000 + n}`,
				`DOC-${20260 + n}`,
				name(n),
				n % 5
					? ""
					: "Checked on arrival; the delivery matched its order and specification",
			];
			body.push(
				cells.map((text, c) => ({ text, align: columns[c]?.[1] ?? "left" })),
			);
		}
		body.push(
			columns.map(([, align], c) => ({
				text: c === 2 ? "Subtotal" : c === 5 ? sum.toFixed(2) : "",
				bold: true,
				fill: "#f3f3f3" as const,
				align,
			})),
		);
	}
	return {
		page: {
			size: "A4",
			landscape: true,
			margin: { top: mm(10), right: mm(10), bottom: mm(20), left: mm(10) },
		},
		fonts: { Roboto: family },
		style: { font: "Roboto", size: 6.5 },
		content: [
			{ text: "Production ledger", bold: true, size: 12 },
			{ text: "Example Works Ltd · Registration 0987654321", size: 8.5 },
			{
				text: `1 January – 31 December 2026 · ${rows} entries`,
				size: 8,
				color: "#696969",
				spaceAfter: 8,
			},
			{
				table: {
					widths: columns.map(([, , width]) =>
						typeof width === "number" ? mm(width) : width,
					),
					borders: "grid",
					borderColor: "#bebebe",
					borderWidth: 0.28,
					padding: 3,
					header,
					rows: body,
				},
			},
		],
		footer: ({ page, pages }) => [
			{
				table: {
					widths: ["*", "*"],
					padding: 0,
					rows: [
						[
							{ text: "Generated on 24 October 2026" },
							{ text: `Page ${page} of ${pages}`, align: "right" },
						],
					],
				},
				size: 7,
				color: "#696969",
				spaceBefore: mm(6),
			},
		],
		watermark: {
			text: "DRAFT",
			bold: true,
			color: "#696969",
			opacity: 0.14,
			angle: 35,
		},
	};
}
