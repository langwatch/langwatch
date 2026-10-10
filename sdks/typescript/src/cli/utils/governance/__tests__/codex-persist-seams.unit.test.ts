/**
 * Every seam writing the `[otel]` block must install the turn harvest
 * beside it. Reads CLI source rather than exercising the seams: a missing
 * call at a not-yet-existing call site is invisible to any test of the rest.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// `__dirname`, not `import.meta.url`: this package type-checks against a
// CommonJS target, where `import.meta` is a compile error (TS1470).
const CLI_ROOT = resolve(__dirname, "..", "..", "..");

const WRITES_EXPORTERS = /\bwriteCodexOtelBlock\s*\(/;
const EVERY_WRITE = /\bwriteCodexOtelBlock\s*\(/g;
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
  .filter(({ source }) => WRITES_EXPORTERS.test(source) && !DECLARES_WRITER.test(source));

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

    // With one write per file, "this file wires the harvest" says the same
    // thing as "this write is wired". A second write in a file the check
    // already passes would not be looked at, so it has to land here first:
    // wire the harvest for it, then let this list say so.
    it("persists in one place per seam, so the pairing speaks for the write", () => {
      const writesPerSeam = seams.map(({ path, source }) => ({
        path,
        writes: source.match(EVERY_WRITE)?.length ?? 0,
      }));

      expect(writesPerSeam.filter(({ writes }) => writes !== 1)).toEqual([]);
    });
  });
});
