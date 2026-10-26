/**
 * Spec: specs/literal-ownership.feature (restated-contract-constant).
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 16.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ClassifiedPackage } from "../../../types.ts";
import { buildWorkspaceSnapshot, type WorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  collectRestatedContractConstants,
  lintRestatedContractConstants,
  restatedConstantKey,
} from "../restated-contract-constant.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-contract-constants-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function contract(module: string): ClassifiedPackage {
  const packageRoot = join(root, "modules", module, "contract");

  return {
    name: `@langwatch/${module}-contract`,
    root: packageRoot,
    manifestPath: join(packageRoot, "package.json"),
    manifest: {},
    kind: "contract",
    feature: module,
    enterprise: false,
  };
}

function snapshot(): WorkspaceSnapshot {
  const read = buildWorkspaceSnapshot({ root, changedFiles: [] });

  return {
    ...read,
    packages: [contract("a"), contract("c")],
    catalogue: [
      { id: "widget-store", root: "modules/widget-store", classification: "core", subjects: [] },
    ],
  };
}

describe("restated-contract-constant", () => {
  describe("when a module spells a contract's exported constant", () => {
    /** @scenario "A literal restating a contract's exported string constant is reported" */
    it("reports each restatement outside the contract", () => {
      write({
        path: "modules/a/contract/src/kinds.ts",
        content: 'export const WIDGET_KIND = "widget_srcdoc" as const;\n',
      });
      write({
        path: "modules/b/process/src/erase.ts",
        content: 'const KIND = "widget_srcdoc";\nexport { KIND };\n',
      });
      write({
        path: "modules/a/browser/src/chart.ts",
        content: 'export const isWidget = (kind: string) => kind === "widget_srcdoc";\n',
      });

      expect(
        collectRestatedContractConstants(snapshot()).map(restatedConstantKey).toSorted(),
      ).toEqual([
        "modules/a/browser/src/chart.ts|widget_srcdoc",
        "modules/b/process/src/erase.ts|widget_srcdoc",
      ]);
    });
  });

  describe("when the string is short, shared vocabulary or the contract's own", () => {
    /** @scenario "Short strings, shared vocabulary and the contract's own files are not reported" */
    it("reports nothing", () => {
      write({
        path: "modules/a/contract/src/constants.ts",
        content: [
          'export const SHORT = "a_b";',
          'export const VERSION = "2026-09-29";',
          'export const MEDIA = "application/octet-stream";',
          'export const MODULE = "widget-store";',
          'export const ATTRIBUTE = "langwatch.thread.id";',
          'export const SHARED = "shared.vocabulary";',
          'export const OWN = "own.constant_value";',
        ].join("\n"),
      });
      write({
        path: "modules/a/contract/src/again.ts",
        content: 'export const again = "own.constant_value";\n',
      });
      write({
        path: "modules/c/contract/src/shared.ts",
        content: 'export const ALSO_SHARED = "shared.vocabulary";\n',
      });
      write({
        path: "packages/span-names/src/keys.ts",
        content: 'export const keys = { THREAD: "langwatch.thread.id" };\n',
      });
      write({
        path: "modules/b/process/src/uses.ts",
        content: [
          '"a_b";',
          '"2026-09-29";',
          '"application/octet-stream";',
          '"widget-store";',
          '"langwatch.thread.id";',
          '"shared.vocabulary";',
        ].join("\n"),
      });

      expect(collectRestatedContractConstants(snapshot())).toEqual([]);
    });
  });

  describe("when a finding is reported", () => {
    /** @scenario "A restated constant finding says to import it from its contract" */
    it("names the constant and says to import it", () => {
      write({
        path: "modules/a/contract/src/kinds.ts",
        content: 'export const WIDGET_KIND = "widget_srcdoc";\n',
      });
      write({
        path: "modules/b/process/src/erase.ts",
        content: 'export const kind = "widget_srcdoc";\n',
      });

      const [finding] = lintRestatedContractConstants(snapshot());

      expect(finding).toMatchObject({ file: "modules/b/process/src/erase.ts", line: 1 });
      expect(finding?.message).toContain("WIDGET_KIND");
      expect(finding?.allowed).toContain("Import WIDGET_KIND from its contract");
    });
  });
});
