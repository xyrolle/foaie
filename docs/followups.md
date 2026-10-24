# Follow-ups

Open work, each with what "done" means. Delete an entry in the change that resolves it.

- **Fallback faces.** A style names a list of families, and a character the first family lacks is drawn from the next one. Done when a mixed-script paragraph prints every character from the first family that has it.
- **CFF outlines.** Done when an OpenType font with CFF outlines is subset and embedded as `FontFile3`, with the same text extraction as a TrueType one. Start only when a user has a font with no TTF build.
- **Streamed output.** `render()` returns a `ReadableStream` that sends each page as it is laid out. The page count in footers would need a shared form XObject that is filled in at the end. Done when a 50,000-row table streams with flat memory.
- **Justified text, and widow and orphan control.** Done when a paragraph can be justified, and a paragraph never leaves one line alone at the top or bottom of a page.
- **Links within the document.** Named destinations, and links to them. Done when a table of contents links to its sections.
- **Tagged PDF.** A structure tree for accessibility. Done when a fixture passes the PDF/UA checks of veraPDF.
- **CMYK colours.** Done when a colour can be given as CMYK and is written as `DeviceCMYK`.
- **Blocks inside table cells.** A cell holds a stack of blocks, not only text. Done when a cell can hold an image and two paragraphs.
- **Forced page breaks.** Done when a block can start a new page.
