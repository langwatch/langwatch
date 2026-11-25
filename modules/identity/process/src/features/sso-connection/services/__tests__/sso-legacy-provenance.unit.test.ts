/**
 * @vitest-environment node
 * Only the grandfather tenant step writes a legacy-configuration proof or a
 * legacy-grandfathered connection; no customer-facing path may.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../../../../", import.meta.url));
const SCANNED_ROOTS = ["modules", "enterprise/modules"];
const SKIPPED_DIRS = new Set(["node_modules", "__tests__", "dist", ".turbo", "generated"]);
const LEGACY_WRITE = /\b(method|source)\s*:\s*"legacy-(configuration|grandfathered)"/;

/** The grandfather step itself, and one read filter that never writes. */
const ALLOWED = new Set([
  "modules/identity/process/src/features/sso-connection/rules/sso-connection-grandfather-facts.rules.ts",
  "modules/identity/process/src/features/sso-connection/services/sso-connection-grandfather.service.ts",
  "modules/identity/process/src/features/sso-connection/repositories/prisma/prisma.sso-connection-routing.repository.ts",
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIPPED_DIRS.has(entry.name)) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile()) return [];
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("given the legacy single sign-on provenance", () => {
  describe("when every product source file is scanned for a legacy proof or source being written", () => {
    /** @scenario "Only the grandfather step writes an earlier-configuration proof or a grandfathered connection" */
    it("finds it only in the grandfather tenant step", () => {
      const writers = SCANNED_ROOTS.flatMap((root) => sourceFiles(join(REPO_ROOT, root)))
        .filter((path) => LEGACY_WRITE.test(readFileSync(path, "utf8")))
        .map((path) => relative(REPO_ROOT, path).split(sep).join("/"));

      expect(writers.filter((path) => !ALLOWED.has(path))).toEqual([]);
      expect(writers).toContain(
        "modules/identity/process/src/features/sso-connection/rules/sso-connection-grandfather-facts.rules.ts",
      );
    });
  });
});
