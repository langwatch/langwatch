import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const API_SOURCE = join(root, "packages/api/src");
const BASELINE = resolve(import.meta.dirname, "../src/api-package-files-baseline.json");

/** The files the rebuild plan ends with; anything else is legacy on its way out. */
const TARGET_FILES = new Set([
  "index.ts",
  "contract/index.ts",
  "contract/trpc-contract.ts",
  "access/index.ts",
  "access/access.ts",
  "trpc/index.ts",
  "trpc/trpc-router.ts",
  "trpc/trpc-runtime.ts",
  "rest/index.ts",
  "rest/rest-router.ts",
  "rest/rest-runtime.ts",
  "rest/rest-openapi.ts",
  "rest/rest-idempotency.ts",
  // The project and credential the transport reads, described rather than
  // imported: the contracts that own them declare their procedures with
  // ./contract, so importing them back would close a declaration cycle.
  "rest/credential.ts",
  // The browser door, folded in from @langwatch/platform-api-client.
  "web/index.ts",
  "web/feature-api.ts",
  "web/trpc-query-key.ts",
  "web/use-invalidate-procedure.ts",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : sourceFiles(path);
    if (!entry.name.endsWith(".ts")) return [];
    if (/\.test(-d)?\.ts$/.test(entry.name)) return [];
    return [relative(API_SOURCE, path).split("\\").join("/")];
  });
}

describe("the @langwatch/api source surface", () => {
  const baseline = JSON.parse(readFileSync(BASELINE, "utf8")) as { files: string[] };
  const allowed = new Set([...baseline.files, ...TARGET_FILES]);
  const present = sourceFiles(API_SOURCE).sort();

  describe("when the package gains a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("refuses every file that is neither in the baseline nor in the rebuild target", () => {
      const additions = present.filter((file) => !allowed.has(file));

      expect(additions).toEqual([]);
    });
  });

  describe("when the package loses a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("ratchets the baseline down so a deleted file cannot come back", () => {
      const stale = baseline.files.filter((file) => !present.includes(file));

      expect(stale).toEqual([]);
    });
  });
});
