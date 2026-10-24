/**
 * Spec: specs/literal-ownership.feature (duplicate-across-modules).
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 4.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import {
  collectDuplicatesAcrossModules,
  lintDuplicatesAcrossModules,
} from "../duplicate-across-modules.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-duplicates-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write({ path, content }: { path: string; content: string }): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A helper long enough to count: 500 bytes of real-looking source. */
const HELPER = Array.from(
  { length: 10 },
  (_, at) => `export const value${at} = "${"x".repeat(30)}";`,
).join("\n");

function snapshot() {
  return buildWorkspaceSnapshot({ root, changedFiles: [] });
}

describe("duplicate-across-modules", () => {
  describe("when two modules hold the same file", () => {
    /** @scenario "A source file byte-identical to one in another module is reported" */
    it("reports both copies, each naming the other", () => {
      write({ path: "modules/a/browser/src/helper.ts", content: HELPER });
      write({
        path: "modules/b/browser/src/model/helper.ts",
        content: HELPER.replaceAll("\n", "\r\n"),
      });

      expect(
        collectDuplicatesAcrossModules(snapshot()).map(({ file, copies }) => ({ file, copies })),
      ).toEqual([
        {
          file: "modules/a/browser/src/helper.ts",
          copies: ["modules/b/browser/src/model/helper.ts"],
        },
        {
          file: "modules/b/browser/src/model/helper.ts",
          copies: ["modules/a/browser/src/helper.ts"],
        },
      ]);
    });
  });

  describe("when the copies are within a module, tests or small", () => {
    /** @scenario "Copies inside one module, tests and small files are not reported" */
    it("reports nothing", () => {
      write({ path: "modules/a/browser/src/one.ts", content: HELPER });
      write({ path: "modules/a/process/src/two.ts", content: HELPER });
      write({ path: "modules/a/browser/src/__tests__/x.unit.test.ts", content: `${HELPER}\n// t` });
      write({ path: "modules/b/browser/src/__tests__/x.unit.test.ts", content: `${HELPER}\n// t` });
      write({ path: "modules/a/browser/src/small.ts", content: "export const small = 1;\n" });
      write({ path: "modules/b/browser/src/small.ts", content: "export const small = 1;\n" });

      expect(collectDuplicatesAcrossModules(snapshot())).toEqual([]);
    });
  });

  describe("when a finding is reported", () => {
    /** @scenario "A duplicate finding says to keep one copy and import it" */
    it("says to keep one copy in the owning module and import it", () => {
      write({ path: "modules/a/browser/src/helper.ts", content: HELPER });
      write({ path: "enterprise/modules/b/browser/src/helper.ts", content: HELPER });

      const [finding] = lintDuplicatesAcrossModules(snapshot());

      expect(finding?.message).toContain("enterprise/modules/b/browser/src/helper.ts");
      expect(finding?.allowed).toContain(
        "Keep one copy in the owning module's contract or package",
      );
    });
  });
});
