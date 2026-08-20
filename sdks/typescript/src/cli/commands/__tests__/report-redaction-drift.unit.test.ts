import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The CLI ships a verbatim mirror of the platform's redaction engine
 * (packages/redaction) so the code agents audit on GitHub is the
 * exact code that scrubs their report. copy-types.sh refreshes the mirror;
 * this test fails when the canonical package changed without regenerating.
 */
const MIRRORED_FILES = [
  "markers.ts",
  "secrets.ts",
  "sessionReport.ts",
] as const;

const generatedDir = join(__dirname, "../../../internal/generated/redaction");
const canonicalDir = join(
  __dirname,
  "../../../../../../packages/redaction/src",
);

describe("the bundled redaction mirror, given the canonical package", () => {
  for (const file of MIRRORED_FILES) {
    it(`matches ${file} byte-for-byte`, () => {
      const generated = readFileSync(join(generatedDir, file), "utf8");
      const canonical = readFileSync(join(canonicalDir, file), "utf8");
      expect(
        generated,
        `src/internal/generated/redaction/${file} drifted from ` +
          `packages/redaction/src/${file}; run ./copy-types.sh`,
      ).toBe(canonical);
    });
  }
});
