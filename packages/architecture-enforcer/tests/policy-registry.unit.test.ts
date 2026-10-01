import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { POLICIES } from "../src/index.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = join(packageRoot, "../../.github/workflows/langwatch-app-ci.yml");

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("given the policy registry", () => {
  describe("when its entries and the package source are read", () => {
    /** @scenario "No policy reads a baseline" */
    it("names only an id, a spec and a run per policy, and ships no baseline file", () => {
      for (const policy of POLICIES) {
        expect(Object.keys(policy).toSorted()).toEqual(["id", "run", "spec"]);
      }

      expect(
        sourceFiles(join(packageRoot, "src")).filter((file) => /baseline/i.test(file)),
      ).toEqual([]);
    });
  });

  describe("when the CI gate's allow-list is read", () => {
    /** @scenario "The CI gate names only registered policies" */
    it("lists registered policy ids only", () => {
      const listed = /--policies\s+([\w,-]+)/.exec(readFileSync(workflow, "utf8"))?.[1] ?? "";
      const ids = listed.split(",").filter((id) => id !== "");
      const registered = new Set(POLICIES.map((policy) => policy.id));

      expect(ids.length).toBeGreaterThan(0);
      expect(ids.filter((id) => !registered.has(id))).toEqual([]);
    });
  });
});
