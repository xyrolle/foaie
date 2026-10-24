/** What went wrong, as a stable code a caller can branch on. */
export type PdfErrorCode =
	| "block-invalid"
	| "color-invalid"
	| "decoration-too-tall"
	| "face-missing"
	| "font-format"
	| "font-invalid"
	| "image-format"
	| "image-invalid"
	| "page-too-small"
	| "table-too-wide";

/** An error foaie raises: its message says what to change, and its code is stable. */
export class PdfError extends Error {
	readonly code: PdfErrorCode;

	constructor(code: PdfErrorCode, message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "PdfError";
		this.code = code;
	}
}
