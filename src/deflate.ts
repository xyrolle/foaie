// zlib-wrapped deflate, as PDF's FlateDecode and PNG's image data use it, through the platform's own
// compression streams: native code in every runtime, and nothing added to the bundle.

export function deflate(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return through(data, new CompressionStream("deflate"));
}

export function inflate(
	data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
	return through(data, new DecompressionStream("deflate"));
}

async function through(
	data: Uint8Array<ArrayBuffer>,
	transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array<ArrayBuffer>> {
	const output = new Response(
		new Blob([data]).stream().pipeThrough(transform),
	).arrayBuffer();
	return new Uint8Array(await output);
}
