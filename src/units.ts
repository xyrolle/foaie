import type { PageSize, Sides } from "./document.ts";

/** Millimetres in points, foaie's unit (1/72 inch). */
export function mm(millimetres: number): number {
	return (millimetres * 72) / 25.4;
}

const SIZES = {
	A3: [841.89, 1190.55],
	A4: [595.28, 841.89],
	A5: [419.53, 595.28],
	Letter: [612, 792],
	Legal: [612, 1008],
} as const;

/** The page's width and height in points, turned when landscape. */
export function pageSize(
	size: PageSize,
	landscape: boolean,
): readonly [number, number] {
	const [width, height] = typeof size === "string" ? SIZES[size] : size;
	return landscape
		? [Math.max(width, height), Math.min(width, height)]
		: [width, height];
}

export function sides(margin: number | Sides<number>): Sides<number> {
	return typeof margin === "number"
		? { top: margin, right: margin, bottom: margin, left: margin }
		: margin;
}
