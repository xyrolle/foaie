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
	| "number-invalid"
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

/** `value` when it is a finite number; otherwise an error naming it as `name`. */
export function finite(value: number, name: string): number {
	if (Number.isFinite(value)) return value;
	throw new PdfError(
		"number-invalid",
		`${name} is ${value}. Give it a finite number.`,
	);
}
