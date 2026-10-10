/** Spec: specs/framework-module-contracts.feature. Record: dev/docs/ARCHITECTURE.md §10.1. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { lintFrameworkModuleContracts } from "../src/policies/boundaries/framework-module-contracts.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-framework-contracts-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writePackage({
  path,
  name,
  devDependencies = {},
}: {
  path: string;
  name: string;
  devDependencies?: Record<string, string>;
}): void {
  const file = join(root, path, "package.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ name, type: "module", devDependencies }), "utf8");
}

describe("framework-module-contracts", () => {
  describe("given a framework package declaring a module contract", () => {
    /** @scenario "A framework package depending on a module contract is reported" */
    it("reports the edge against the framework manifest", () => {
      writePackage({ path: "modules/agent/contract", name: "@langwatch/agent-contract" });
      writePackage({
        path: "packages/browser-host",
        name: "@langwatch/browser-host",
        devDependencies: { "@langwatch/agent-contract": "workspace:*" },
      });

      const violations = lintFrameworkModuleContracts(snapshotOf({ root }));

      expect(violations.map((violation) => violation.specifier)).toEqual([
        "@langwatch/agent-contract",
      ]);
      expect(violations[0]?.file).toContain("packages/browser-host/package.json");
    });
  });

  describe("given a module package declaring a contract", () => {
    /** @scenario "A module depending on its own or a peer's contract is not reported" */
    it("reports nothing", () => {
      writePackage({ path: "modules/agent/contract", name: "@langwatch/agent-contract" });
      writePackage({
        path: "modules/scenario/browser",
        name: "@langwatch/scenario-browser",
        devDependencies: { "@langwatch/agent-contract": "workspace:*" },
      });

      expect(lintFrameworkModuleContracts(snapshotOf({ root }))).toEqual([]);
    });
  });
});
