/**
 * Structural proof of the Entitlement boundary: the contract carries no provider implementation,
 * no other feature imports the process package, and nothing reads the environment on import.
 * @see modules/entitlement/specs/entitlement-resolution.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ENTITLEMENT_ROOT = join(import.meta.dirname, "..", "..", "..");
const REPOSITORY_ROOT = join(ENTITLEMENT_ROOT, "..", "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

function specifiersOf(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)].map(
    (match) => match[1]!,
  );
}

const PROVIDERS = /billing|licensing|stripe|@prisma\/|prisma-client|enterprise/i;

describe("the Entitlement boundary", () => {
  describe("when a core feature needs an organization's plan", () => {
    /** @scenario "Core consumers import only the entitlement contract" */
    it("finds no provider in the contract and no entitlement process import in any other feature", () => {
      const contract = JSON.parse(
        readFileSync(join(ENTITLEMENT_ROOT, "contract", "package.json"), "utf8"),
      ) as { dependencies?: Record<string, string> };
      const providerDeps = Object.keys(contract.dependencies ?? {}).filter((name) =>
        PROVIDERS.test(name),
      );
      const providerImports = sourceFiles(join(ENTITLEMENT_ROOT, "contract", "src")).flatMap(
        (file) => specifiersOf(file).filter((spec) => PROVIDERS.test(spec)),
      );
      const importers = sourceFiles(join(REPOSITORY_ROOT, "modules"))
        .concat(sourceFiles(join(REPOSITORY_ROOT, "enterprise", "modules")))
        .filter((file) => !file.startsWith(ENTITLEMENT_ROOT))
        .filter((file) => /@langwatch\/entitlement-process/.test(readFileSync(file, "utf8")));

      expect(providerDeps).toEqual([]);
      expect(providerImports).toEqual([]);
      expect(importers).toEqual([]);
    });
  });

  describe("when a runtime installs the entitlement module", () => {
    /** @scenario "The entitlement installer constructs its private service" */
    it("reads no process environment from the contract or the process package", () => {
      const readers = ["contract", "process"].flatMap((half) =>
        sourceFiles(join(ENTITLEMENT_ROOT, half, "src")).filter((file) =>
          readFileSync(file, "utf8")
            .split("\n")
            .some((line) => !/^\s*(\/\/|\/?\*)/.test(line) && /process\.env\b/.test(line)),
        ),
      );

      expect(readers).toEqual([]);
    });
  });
});
