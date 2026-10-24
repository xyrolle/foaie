# Design

foaie lays out a declarative document and writes it as a PDF. These are the decisions, each with its reason.

## Goals

Three reference shapes set the bar. They come from production apps that render PDFs inside Cloudflare Workers:
- **A one-page A5 document** with label/value rows and a totals table. Its largest form runs to 3 pages.
- **An A4 table** of 14–120 rows.
- **A landscape table of 16 columns** with group bands, subtotals, a "page X of Y" footer and a watermark, up to 5,000 rows (about 230 pages).

The targets, each a warm render measured in workerd:
- the one-page A5 document under 1 ms;
- the first PDF in a fresh isolate, the import included, under 10 ms;
- 5,000 table rows in about 150 ms, in under 50 MB of heap;
- the library itself about 6 KB min+gzip.

The libraries those apps use today, measured on the same shapes:

| Library | One-page A5 document | 5,000-row table |
|---|---|---|
| pdfmake | 15 ms | 2.5 s, 246 MB of heap |
| jsPDF with autotable | 11 ms | 1.4 s, 174 MB of heap |

`bench/` reproduces every number.

**Not goals:**
- reading or editing existing PDFs;
- forms, encryption, signatures and PDF/A;
- right-to-left and complex scripts;
- HTML or CSS input.

## The API

```ts
import { font, render } from "foaie";

const sans = {
  normal: font(regularBytes), // parsed once, reused by every render
  bold: font(boldBytes),
  italic: font(italicBytes),
};

const pdf: Uint8Array = await render({
  page: { size: "A5", margin: 36 },
  fonts: { Sans: sans },
  style: { font: "Sans", size: 10 },
  content: [
    { text: "Example Studio Ltd", size: 9, color: "#555" },
    { text: "Invoice 0007", bold: true, size: 14, spaceBefore: 12 },
    {
      table: {
        widths: ["*", "auto"],
        borders: "rows",
        rows: [
          ["Consulting, 10 hours", { text: "1 500.00", align: "right" }],
          [{ text: "Total", bold: true }, { text: "1 500.00", bold: true, align: "right" }],
        ],
      },
    },
  ],
  footer: ({ page, pages }) => [{ text: `Page ${page} of ${pages}`, align: "right", size: 7 }],
  info: { title: "Invoice 0007" },
});
```

**The whole public surface:**
- `render(document)` returns a promise of the bytes. It is async because compression goes through the platform's `CompressionStream`.
- `font(bytes)` returns a `Font`.
- `image(bytes)` returns a promise of an `Image`.
- `mm(n)` converts millimetres to points.
- `PdfError` carries a stable `code`.
- The types of a definition.

### The definition

```ts
type Document = {
  page: { size: "A3" | "A4" | "A5" | "Letter" | "Legal" | [number, number]; landscape?: boolean; margin: number | Sides<number> };
  fonts: Record<string, { normal: Font; bold?: Font; italic?: Font; boldItalic?: Font }>;
  style: TextStyle & { font: string };            // the document's defaults
  content: Block[];
  header?: (at: { page: number; pages: number }) => Block[];
  footer?: (at: { page: number; pages: number }) => Block[];
  watermark?: TextStyle & { text: string; opacity?: number; angle?: number };
  info?: { title?: string; author?: string; subject?: string; keywords?: string; creator?: string; created?: Date };
  lang?: string;
};

type Block = Paragraph | Table | Picture | Stack;
type Paragraph = Spacing & TextStyle & { text: string | Span[]; align?: Align; link?: string; keepWithNext?: boolean };
type Span = string | (TextStyle & { text: string; link?: string });
type Table = Spacing & TextStyle & { keepTogether?: boolean; table: {
  widths: (number | "auto" | "*")[];
  header?: Cell[][];                               // repeated on every page the table continues on
  rows: Cell[][];
  borders?: "grid" | "rows" | "none";              // "none" by default
  borderColor?: Color; borderWidth?: number;
  padding?: number | { x: number; y: number };     // 4 × 2 points by default
} };
type Cell = string | (TextStyle & { text: string | Span[]; align?: Align; fill?: Color; colSpan?: number; border?: Partial<Sides<boolean>> });
type Picture = Spacing & { image: Image; width?: number; height?: number; align?: Align };
type Stack = Spacing & { stack: Block[]; keepTogether?: boolean };
type TextStyle = { font?: string; size?: number; bold?: boolean; italic?: boolean; color?: Color; lineHeight?: number };
type Spacing = { spaceBefore?: number; spaceAfter?: number };
type Align = "left" | "center" | "right";
type Color = `#${string}`;                         // #rgb or #rrggbb
type Sides<T> = { top: T; right: T; bottom: T; left: T };
```

- **A document is data, not drawing calls.** A definition is built from records with plain code, and a test can compare definitions without opening a PDF. Layout stays the library's job.
- **There are four kinds of block: a paragraph, a table, an image and a stack.**
  - Each kind is named by its one key: `text`, `table`, `image` or `stack`. A block with none of them, or with two, throws `block-invalid`.
  - Side-by-side content, such as a label beside its value, is a borderless table. One mechanism covers it instead of two.
- **Style is inherited: from the document, to the block, to the cell, to the span.**
  - There are no named style sheets. The definition is code, so a shared style is a constant spread into blocks.
- **The unit is the point (1/72 inch).** `mm()` exists because A-series pages, and the people who lay them out, think in millimetres.
- **A table's widths are outer widths, padding included,** so the numbers add up to what is printed. pdfmake's widths leave the padding out; that is deliberately not copied.
- **Spacing is vertical only: `spaceBefore` and `spaceAfter`.** Blocks fill the content width, and horizontal placement goes through a table. No reference document needs indents.
- **Colours are `#rgb` or `#rrggbb`, in RGB.** CMYK is a follow-up.
- **A family has up to four faces, and `bold` and `italic` pick one.**
  - A face the style asks for but the family lacks throws `face-missing`. It is never faked: synthetic bold and slanted roman look wrong in print.
  - There are no built-in fonts. The PDF standard fonts cover Windows-1252 only, which has no ș, ț or Cyrillic, and each would carry its metrics table.

## Fonts

- **TrueType outlines (`glyf`) only.**
  - OpenType with CFF outlines, WOFF, WOFF2 and font collections throw `font-format`, and the message says to use the family's TTF build. Every common open family ships one.
  - Subsetting CFF means rewriting charstrings and subroutines. That is about as much code again as the whole TrueType path, for fonts that also exist as TTF.
- **A variable font draws its default instance.**
- **A subset keeps only the glyphs a document draws,** renumbered in order of use, together with the parts of any composite glyph. It keeps only the tables a PDF reader uses: `head`, `hhea`, `maxp`, `hmtx`, `loca` and `glyf`, plus `cvt`, `fpgm` and `prep` when present.
  - The prototype's one-page A5 document, with three faces, is 10.4 KB. pdfmake writes 11.7 KB, and jsPDF 26 KB.
- **The font is embedded as a `CIDFontType2` with `Identity-H` encoding, its glyph widths and a `ToUnicode` map,** so its text can be copied, searched and extracted.
  - A `ToUnicode` map gives each glyph one text. So two characters the face draws alike, such as ∆ and Δ in many fonts, or every character it lacks with its `.notdef`, each get their own copy of the glyph, and each extracts as written.
- **The caller parses a font once.** `font()` takes 0.3–1 ms per face (measured), more than a whole one-page document. After that, a render only looks things up.

## Text

- **Shaping is Unicode NFC, then the character map, advance widths and pair kerning.**
  - Kerning comes from GPOS pair positioning (formats 1 and 2), or from the `kern` table when there is no GPOS.
  - There are no ligatures. They change what text extraction returns, and gain little in a 10-point business document.
- **Scope: left-to-right scripts whose letters compose under NFC.**
  - This covers Latin (Romanian and Vietnamese included), Greek, Cyrillic, Armenian and Georgian.
  - Arabic, Hebrew, Indic and Southeast Asian scripts print in logical order, unshaped. Shaping them correctly would take an engine larger than this whole library.
- **A character the face lacks prints the face's `.notdef` box.** Fallback faces are a follow-up.
- **Line breaking:**
  - a line breaks at spaces and after hyphens;
  - a no-break space holds its words together;
  - spaces in a row set as one, and a line drops the spaces at its ends, as HTML does;
  - `\n` starts a new line, and so do `\r\n` and `\r`, as text from a form or a Windows file has them;
  - a tab reads as a space;
  - a word wider than the line breaks between characters, which is also how a CJK paragraph breaks.

  The full Unicode line-breaking algorithm is out of scope.
- **Alignment is left, centre or right.** Justification is a follow-up.
- **Line height is the face's ascender minus its descender, plus its line gap, times `lineHeight` (1 by default).** That is the spacing the font's designer set, as CSS `line-height: normal` uses.

## Layout and page breaking

- **One flow per page body, top to bottom.** The body is the page minus its margins. Each block splits only at its own boundaries:
  - a paragraph between lines;
  - a table between rows, with its header rows repeated on every page it continues on;
  - an image never splits, and one taller than the body is scaled down to fit.
- **A table row moves whole to the next page when it fits on an empty one.** A row taller than a page splits between its lines, and every part repeats the header. Long tables are read row by row, so splitting is kept for rows that can never fit.
- **`keepWithNext` keeps a paragraph on the page with the first line or row after it.** It is meant for headings.
- **`keepTogether` moves a stack or a table to the next page whole, when it fits on one page.** If it can't, it flows as usual.
- **Widow and orphan control is a follow-up.**
- **The header and footer are functions of `{ page, pages }`.**
  - They are laid out once the body is paginated, inside the top and bottom margins.
  - One that is taller than its margin throws `decoration-too-tall`.
  - The page count is known only at the end. A body that never depends on its decorations paginates in one pass.
- **The watermark is text centred on every page, rotated and translucent,** and sized to span 60% of the page's diagonal unless it names a `size`. It is drawn over the content, so cell fills don't hide it.
- **Table columns:**
  - a fixed width;
  - `auto`, the widest single line of the column's cells;
  - `*`, an equal share of what is left.

  When the fixed and `auto` columns exceed the content width, the `auto` columns first give space back, down to their longest word. Then the table throws `table-too-wide`, naming both widths. It never squeezes or overflows silently.
- **A cell can span columns and have a fill.**
  - The table's borders are `grid`, `rows` (a rule between rows) or `none`.
  - A cell can override any side with `border`. That covers a rule above a total and a signature line.

## Images

- **`image(bytes)` parses once and returns an `Image` to place.**
  - **JPEG** is embedded as it is, compressed with DCT. That covers baseline and progressive, in grey, RGB and CMYK.
  - **PNG**, when not interlaced, is embedded as its own compressed image data with PNG predictors, with no decoding. That covers grey, RGB and palette images, at 8 or 16 bits.
  - **Transparency** (an alpha channel or palette transparency) becomes a soft mask. That needs the data inflated once, through `DecompressionStream`, which is why `image()` is async.
  - **An interlaced PNG** throws `image-format`, and the message says to save it without interlacing.
- **An image's default size is its pixels at 96 per inch,** the CSS pixel, scaled down to the content width when wider. Given one of `width` or `height`, the other keeps the aspect ratio.
- **An image placed twice is written once.**

## Links and metadata

- **`link` on a paragraph or a span becomes a URI link annotation** over the text, on every line it spans. Links within the document are a follow-up.
- **`info` becomes the document information dictionary, and `lang` becomes `/Lang`.**
  - There is no XMP.
  - There is no tagged structure. Accessibility tags are a follow-up.

## Output

- **PDF 1.7, with a classic cross-reference table.**
- **The same definition renders the same bytes.**
  - A subset's tag is derived from its face and its glyph set.
  - Nothing reads a clock: a creation date is written only from `info.created`.
- **Content streams, font programs, `ToUnicode` maps and image masks are compressed with the platform's `CompressionStream`.** It is native code, and it adds nothing to the bundle.
  - A stream under 1 KB is written as it is. Each compression costs a round trip through the stream machinery, about 0.15–0.4 ms in Node, which is more than it saves on a footer of a few hundred bytes.
- **Memory is bounded by the page.**
  - A page's content is joined into one string as soon as the page is laid out. It compresses while the next pages are laid out, and only its compressed bytes are kept.
  - At most 8 pages compress at once, and the objects are written in the order they were given, whatever order they finish compressing in. So the bytes stay the same from run to run.
  - Fonts and the cross-reference table are written at the end.
  - Joining the strings matters: V8 keeps many small strings concatenated as ropes. In the prototype, joining each finished page took the 5,000-row table from 135 MB to 47 MB of heap and halved its CPU time. Compressing each page as it finishes takes the table under 24 MB.
- **`render()` returns the whole file.**
  - A streamed variant is a follow-up. No user needs one at 5,000 rows.
  - A footer that prints the page count needs that count before its page can be written.

## Runtimes and packaging

- **ESM only, with one entry point and its type declarations.** There are no `node:` imports.
- **The platform APIs it uses:** typed arrays and `DataView`, `TextEncoder`, `String.prototype.normalize`, `CompressionStream("deflate")`, and `DecompressionStream("deflate")` (PNG transparency only).
  - These exist in Workers, Node 18 and later, Bun, Deno, Chrome 80, Firefox 113 and Safari 16.4.
  - The tests run on Node, workerd, Bun, Deno and Chromium.
- **Image decoding sits behind `image()`.** A bundle that never calls it doesn't carry it.

## Verification

- **Conformance.** Every fixture PDF is:
  - opened by pdf.js, with its extracted text compared with the definition's text;
  - checked with `qpdf --check` where qpdf is installed;
  - rendered by pdf.js in Chromium and compared with a golden image within a small tolerance.
- **The benchmark** (`bench/`) runs foaie, pdfmake, jsPDF, pdfkit and pdf-lib on the reference shapes with one command:
  - in Node: CPU time and heap;
  - in workerd: time per render and the cold import.
- **CI runs a performance smoke check with budgets about twice the targets.** It is noise-proof, and it catches slow creep.

## Migrating from pdfmake

| pdfmake | Here |
|---|---|
| `{ columns: [{ text, width: 90 }, { text }] }` | A borderless table: `widths: [90, "*"]`, one row |
| `layout: "lightHorizontalLines"` / `"noBorders"` | `borders: "rows"` / `"none"` |
| `margin: [0, 12, 0, 2]` | `spaceBefore: 12, spaceAfter: 2` |
| `italics: true`, `alignment: "right"` | `italic: true`, `align: "right"` |
| `pageSize`, `pageOrientation`, `pageMargins`, `defaultStyle` | `page.size`, `page.landscape`, `page.margin`, `style` |
| `headerRows: 1` | the rows go in `header` |
| A table width that leaves the padding out | the width includes it |
| A virtual file system of base64 fonts | `font(bytes)`, once per process or isolate |

## Migrating from jsPDF with autotable

| jsPDF with autotable | Here |
|---|---|
| `autoTable(doc, { head, body, theme: "grid" })` | `table: { header, rows, borders: "grid" }` |
| `colSpan` and `styles.fillColor` on a cell | `colSpan` and `fill` |
| `didParseCell` to style a row | the row's cells carry their own style |
| `columnStyles: { 0: { cellWidth, halign } }` | `widths`, and `align` on the cells |
| A footer loop with `setPage(n)` | `footer({ page, pages })` |
| A watermark drawn with `GState` and `angle` | `watermark: { text, opacity, angle }` |
| `addFileToVFS` and `addFont` | `font(bytes)` |
