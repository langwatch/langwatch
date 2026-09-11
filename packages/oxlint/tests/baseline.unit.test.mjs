import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  isBaselined,
  loadBaseline,
  resetBaselineCache,
  validateBaseline,
} from "../src/baseline.mjs";

let root = "";

function writeBaselineFile(entries) {
  const dir = join(root, "packages/architecture-enforcer/src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "oxlint-baseline.json"), JSON.stringify({ version: 0, entries }));
}

describe("baseline", () => {
  afterEach(() => {
    resetBaselineCache();
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  describe("when a file has a baseline entry for the rule", () => {
    it("reports isBaselined true", () => {
      root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
      writeBaselineFile([
        { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
      ]);

      expect(
        isBaselined({ cwd: root, file: "apps/api/src/foo.ts", rule: "cognitive-complexity" }),
      ).toBe(true);
    });
  });

  describe("when a file has no baseline entry for the rule", () => {
    it("reports isBaselined false", () => {
      root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
      writeBaselineFile([
        { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
      ]);

      expect(
        isBaselined({ cwd: root, file: "apps/api/src/bar.ts", rule: "cognitive-complexity" }),
      ).toBe(false);
      expect(isBaselined({ cwd: root, file: "apps/api/src/foo.ts", rule: "condition-shape" })).toBe(
        false,
      );
    });
  });

  describe("when no baseline file exists", () => {
    it("reports isBaselined false for every file", () => {
      root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));

      expect(
        isBaselined({ cwd: root, file: "apps/api/src/foo.ts", rule: "cognitive-complexity" }),
      ).toBe(false);
    });
  });

  describe("when the same cwd is loaded twice", () => {
    it("reads the file once and reuses the memo", () => {
      root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
      writeBaselineFile([
        { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
      ]);

      const first = loadBaseline(root);
      writeBaselineFile([]);
      const second = loadBaseline(root);

      expect(second).toBe(first);
      expect(second.has("cognitive-complexity|apps/api/src/foo.ts")).toBe(true);
    });
  });

  describe("when an entry has no measured date", () => {
    it("throws rather than treating the file as baselined forever", () => {
      root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
      writeBaselineFile([{ key: "cognitive-complexity|apps/api/src/foo.ts" }]);

      expect(() =>
        isBaselined({ cwd: root, file: "apps/api/src/foo.ts", rule: "cognitive-complexity" }),
      ).toThrow(/measured/);
    });
  });

  describe("validateBaseline", () => {
    it("passes a sorted document with no duplicates and every entry measured", () => {
      expect(
        validateBaseline({
          version: 0,
          entries: [
            { key: "cognitive-complexity|a.ts", measured: "2026-09-06" },
            { key: "cognitive-complexity|b.ts", measured: "2026-09-06" },
          ],
        }),
      ).toEqual([]);
    });

    it("reports a duplicate key", () => {
      const errors = validateBaseline({
        version: 0,
        entries: [
          { key: "cognitive-complexity|a.ts", measured: "2026-09-06" },
          { key: "cognitive-complexity|a.ts", measured: "2026-09-06" },
        ],
      });

      expect(errors.some((e) => e.includes("duplicate"))).toBe(true);
    });

    it("reports an unsorted document", () => {
      const errors = validateBaseline({
        version: 0,
        entries: [
          { key: "cognitive-complexity|b.ts", measured: "2026-09-06" },
          { key: "cognitive-complexity|a.ts", measured: "2026-09-06" },
        ],
      });

      expect(errors.some((e) => e.includes("sorted"))).toBe(true);
    });
  });
});
