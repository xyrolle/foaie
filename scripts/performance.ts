// A performance smoke check for CI: the one-page invoice and the 5,000-row ledger, rendered warm,
// against budgets five to seven times what they take on an M-series Mac, so a shared runner's slower
// cores and noise stay under them and a slow creep still crosses them. Then the ledger is rendered
// again in a process whose heap is capped at 48 MB, well under a Worker's 128 MB.
//
// usage: node scripts/performance.ts

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { render } from "../src/index.ts";
import { invoice, ledger } from "../test/documents.ts";
import { roboto } from "../test/roboto.ts";

/** Milliseconds: on an M-series Mac the invoice takes about 0.8 ms and the ledger about 120 ms. */
const budgets = { invoice: 6, ledger: 600 };
/** The heap the 5,000-row ledger must render in, in megabytes. */
const HEAP_LIMIT = 48;

async function median(
	runs: number,
	work: () => Promise<unknown>,
): Promise<number> {
	const times: number[] = [];
	for (let i = 0; i < runs; i++) {
		const start = performance.now();
		await work();
		times.push(performance.now() - start);
	}
	return (
		times.sort((a, b) => a - b)[Math.floor(runs / 2)] ??
		Number.POSITIVE_INFINITY
	);
}

if (process.argv[2] === "--ledger-only") {
	await render(ledger(roboto(), 5000));
	process.exit(0);
}

const family = roboto();
const typical = invoice(family, "typical");
const long = ledger(family, 5000);
await render(typical);
await render(long);
const measured = {
	invoice: await median(31, () => render(typical)),
	ledger: await median(5, () => render(long)),
};

let failed = false;
for (const step of ["invoice", "ledger"] as const) {
	const over = measured[step] > budgets[step];
	failed ||= over;
	console.log(
		`${step}: ${measured[step].toFixed(1)} ms (budget ${budgets[step]} ms)${over ? "  OVER BUDGET" : ""}`,
	);
}
try {
	execFileSync(
		process.execPath,
		[
			`--max-old-space-size=${HEAP_LIMIT}`,
			fileURLToPath(import.meta.url),
			"--ledger-only",
		],
		{ stdio: "pipe" },
	);
	console.log(`ledger in a ${HEAP_LIMIT} MB heap: fits`);
} catch (error) {
	failed = true;
	console.log(`ledger in a ${HEAP_LIMIT} MB heap: FAILED`, error);
}
process.exit(failed ? 1 : 0);
