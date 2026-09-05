/**
 * @vitest-environment node
 *
 * @see specs/scenarios/child-execution-contract.feature
 *
 * scenario-execution-data.ts is the validated stdin contract between the
 * worker and its isolated child. Only the code that builds or parses that
 * stdin payload — the contract definition itself, the server adapters that
 * serialize it, and the worker entrypoint that runs the child — may name one
 * of its schemas as a value. Suite authoring and the browser never should.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const CONTRACT_SRC = fileURLToPath(new URL("../", import.meta.url));

const SCHEMA_NAMES = readFileSync(join(CONTRACT_SRC, "scenario-execution-data.ts"), "utf8")
  .split("\n")
  .map((line) => /^export const (\w+Schema)\b/.exec(line)?.[1])
  .filter((name): name is string => name !== undefined);

const ALLOWED_ROOTS = [
  join(CONTRACT_SRC), // the definition itself
  join(REPO_ROOT, "packages/features/scenario/server/src"),
  join(REPO_ROOT, "apps/worker/src/scenario-child.entrypoint.ts"),
];

const SCAN_ROOTS = [join(REPO_ROOT, "apps"), join(REPO_ROOT, "packages")];

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".next",
  ".claude",
]);

const EXTENSIONS = [".ts", ".tsx"];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return SKIP_DIR_NAMES.has(entry.name) ? [] : sourceFiles(path);
    }
    return EXTENSIONS.some((extension) => entry.name.endsWith(extension)) ? [path] : [];
  });
}

function isAllowed(file: string): boolean {
  return ALLOWED_ROOTS.some(
    (root) => file === root.replace(/\/$/, "") || file.startsWith(root.replace(/\/$/, "") + "/"),
  );
}

describe("the child execution contract's schemas", () => {
  describe("given every TypeScript source file in apps and packages", () => {
    describe("when a file outside the child's own tree names one of the schemas", () => {
      /** @scenario "Nothing outside the child's own tree imports the execution contract" */
      it("finds no such usage", () => {
        expect(
          SCHEMA_NAMES.length,
          "the schema-name scan itself must find schemas",
        ).toBeGreaterThan(0);

        const pattern = new RegExp(`\\b(${SCHEMA_NAMES.join("|")})\\b`);
        const leaks = SCAN_ROOTS.flatMap(sourceFiles)
          .filter((file) => !isAllowed(file))
          .filter((file) => !file.includes("/__tests__/"))
          .filter((file) => pattern.test(readFileSync(file, "utf8")))
          .map((file) => file.replace(REPO_ROOT, ""));

        expect(leaks).toEqual([]);
      });
    });
  });

  describe("given the shared field mapping module", () => {
    describe("when its imports are inspected", () => {
      /** @scenario "The shared field mapping schema carries no framework dependency" */
      it("imports zod and nothing else", () => {
        const source = readFileSync(join(CONTRACT_SRC, "field-mapping.ts"), "utf8");
        const specifiers = [
          ...source.matchAll(/^import\s+(?:type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/gm),
        ].map((match) => match[1]);

        expect(
          specifiers.every((specifier) => specifier === "zod"),
          specifiers.join(", "),
        ).toBe(true);
      });
    });
  });
});
