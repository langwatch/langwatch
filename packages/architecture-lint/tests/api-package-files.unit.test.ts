import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const API_SOURCE = join(root, "packages/api/src");

/**
 * The whole source surface of `@langwatch/api`, named file by file.
 *
 * The legacy builder family and the 66 files only it reached are gone, so this
 * is no longer a target the package is converging on: it IS the package, and
 * the two assertions below hold it there in both directions.
 */
const TARGET_FILES = new Set([
  "index.ts",
  "access-policy.ts",
  "composition.ts",
  "errors.ts",
  "handler-arguments.ts",
  "ports.ts",
  "schema.ts",
  "websocket.ts",
  "access/index.ts",
  "access/access.ts",
  "contract/index.ts",
  "contract/trpc-contract.ts",
  // Nine transport files. Anything else under rest/ or trpc/ is a regression.
  "rest/index.ts",
  "rest/runtime.ts",
  "rest/request.ts",
  "rest/credential.ts",
  "rest/response.ts",
  "rest/openapi.ts",
  "rest/security.ts",
  "trpc/index.ts",
  "trpc/runtime.ts",
  "trpc/policy.ts",
  "trpc/audit.ts",
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
  const present = sourceFiles(API_SOURCE).sort();

  describe("when the package gains a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("refuses every file the layout does not name", () => {
      const additions = present.filter((file) => !TARGET_FILES.has(file));

      expect(additions).toEqual([]);
    });
  });

  describe("when the package loses a source file", () => {
    /** @scenario "The api package accepts no new file outside the rebuild target" */
    it("ratchets the layout down so a deleted file cannot come back", () => {
      const missing = [...TARGET_FILES].filter((file) => !present.includes(file)).sort();

      expect(missing).toEqual([]);
    });
  });
});
