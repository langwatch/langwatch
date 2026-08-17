/**
 * The codex exporters and the turn harvest are one wiring: the `[otel]` block
 * on its own reports tokens and captures no conversation. Every seam that
 * writes the block has to install the harvest beside it.
 *
 * This reads the CLI source instead of exercising the seams, because the
 * defect is a missing call at a call site that does not exist yet, which no
 * test of the seams we already have can see. Two seams shipped without the
 * harvest exactly that way.
 *
 * Spec: specs/ai-governance/cli-wrappers/shell-rc-persistence.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// `__dirname`, not `import.meta.url`: this package type-checks against a
// CommonJS target, where `import.meta` is a compile error (TS1470).
const CLI_ROOT = resolve(__dirname, "..", "..", "..");

const WRITES_EXPORTERS = /\bwriteCodexOtelBlock\s*\(/;
const WIRES_HARVEST = /\b(?:assert|install)CodexTurnHarvest\s*\(/;
/** The module the writer lives in is where it is declared, not a seam. */
const DECLARES_WRITER = /\bfunction\s+writeCodexOtelBlock\b/;

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" ? [] : sourceFiles(path);
		}
		return entry.isFile() && path.endsWith(".ts") ? [path] : [];
	});
}

const seams = sourceFiles(CLI_ROOT)
	.map((path) => ({
		path: relative(CLI_ROOT, path),
		source: readFileSync(path, "utf8"),
	}))
	.filter(
		({ source }) =>
			WRITES_EXPORTERS.test(source) && !DECLARES_WRITER.test(source),
	);

describe("the seams that persist the codex exporters", () => {
	describe("given every file that writes the [otel] block", () => {
		/** @scenario "A new seam that writes the exporters cannot ship without the harvest" */
		it("wires the turn harvest beside the write", () => {
			const unpaired = seams
				.filter(({ source }) => !WIRES_HARVEST.test(source))
				.map(({ path }) => path);

			expect(unpaired).toEqual([]);
		});

		// A rename that stops the scan matching anything would leave the check
		// above passing over nothing at all.
		it("finds the seams it is checking", () => {
			expect(seams.length).toBeGreaterThanOrEqual(4);
		});
	});
});
