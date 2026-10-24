# foaie: contributor guide

foaie is a small PDF writer for business documents: receipts, invoices, reports and long registers. A document is a plain data definition, and the output is PDF bytes. It has no dependencies and runs on the platform alone: Workers, Node, Bun, Deno and browsers.

## Design invariants
- **A document is data.** One declarative definition goes in and the PDF's bytes come out. There is no drawing cursor, no builder state and no global state.
- **The library has no dependencies. It uses only the platform:** typed arrays, `TextEncoder`, `CompressionStream` and `DecompressionStream`. The same build runs unchanged in every runtime.
- **The same definition always renders the same bytes.** Nothing reads a clock or a random source. A creation date is written only when the definition gives one.
- **Fonts are embedded and subset, never referenced.** Every glyph drawn maps back to its text, so a reader can search, copy and extract it.
- **The caller parses a font or an image once, with `font()` or `image()`, and reuses it across renders.** A render never parses a font again.
- **What the library can't honour fails with a typed error that names the fix:** a missing face, an unsupported font format, or a table wider than its page. It never silently lays out something different. The one stated exception is a character the face has no glyph for: it prints the face's `.notdef` box, as every PDF writer does.
- **Memory is bounded by the page, not by the document.** A finished page is written out before the next one is laid out.
- **Performance claims are measured.** Every claim is backed by a benchmark in `bench/` against pdfmake, jsPDF, pdfkit and pdf-lib, on the document shapes in `docs/design.md`.

## Quality bar

The code is small, readable and maintainable by a stranger. Every line earns its place.

- **The smallest public API that covers the real use.** No option, flag, hook or extension point without a concrete user today. Adding one later is easy; removing one is a breaking change.
- **No abstraction without two real uses.** No factories, registries, plugin systems or generic layers "for later".
- **Short files, short functions and plain control flow.** Each file has one job, in about 200 lines or fewer, and reads top to bottom. A reader understands a function without scrolling or jumping between files.
- **Names say what a thing is in the domain:** a glyph, a run, a line, a row, a page. No `utils`, `helpers` or `manager` dumping grounds.
- **No dead code, commented-out code or TODOs in `main`.** Open work goes in `docs/followups.md`.
- **Dependencies are a cost.** The library has none. Development dependencies are allowed only where a review agrees.
- **Errors are typed and actionable.** A message says what went wrong and what to do; nothing is swallowed.
- **Tests are few, meaningful and readable.** Each one names a behaviour and fails for one reason. No generated matrices and no snapshot dumps.
- **Optimise only where it's measured to matter, and keep the fast path as readable as the slow one.** A clever optimisation that makes the code harder to read needs a number that justifies it.
- **Every change reaches `main` through a pull request, and nothing merges before review:**
  - one review for design, simplicity, soundness and clean code;
  - findings fixed first, as new commits on the PR branch;
  - then a rebase-merge, so the atomic commits land on `main` as they are.

## Working rules

### Commits and pull requests
- Every commit message is a single-line title with a conventional prefix (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `chore:`). No body, no bullet points.
- One cause per commit. A commit carries the test that proves it: red before, green after.
- No `Co-Authored-By` trailer and no AI or tool attribution, in commits, pull request titles or descriptions.
- Never force push a shared branch. Changes after review go in as new commits.
- A pull request description says what was wrong or missing, what changed and how it was tested. Short, plain, and true to the code as it stands.

### Code
- The smallest change at the cause. Weigh the alternatives and pick the simplest one that fully solves the problem.
- No `as any`, no casts, no `@ts-ignore`/`@ts-expect-error` and no avoidable `!`. Model the type instead.
- No deprecated platform or language APIs.
- Code reads at a glance. A chain that needs a comment becomes a named constant or a small named function. Comments say why, never what. A comment may cite the specification it follows (ISO 32000, OpenType, PNG, JPEG).
- No legacy or compatibility code. Delete what you replace in the same change; no fallbacks "for old callers", no aliases.
- Public API changes are deliberate. Every exported name is documented and tested.

### Tests
- Tests exercise the real thing: real fonts and images, and every PDF they render is opened by real readers. pdf.js parses it and extracts its text, `qpdf --check` validates it where qpdf is installed, and layout is compared with golden images.
- A test creates the data it needs and leaves nothing behind.
- No timing sleeps. Wait for an observable condition.

### Tooling
- pnpm only, with the version pinned in `packageManager`. Node 24 LTS.
- The latest stable, fastest tooling: Biome (lint and format), Vitest, and TypeScript 7 (`tsgo`) for type checking.
- `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm test:performance` all pass before a push.

### Docs
- Docs record decisions and their reasons, not implementation retellings.
- Open follow-ups go in `docs/followups.md`, each with "done when"; delete an entry in the change that resolves it.
