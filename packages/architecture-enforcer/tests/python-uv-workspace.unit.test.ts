import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// specs/dependencies/python-uv-workspace.feature — one uv workspace at the
// repository root resolves every member Python project (ADR-145).

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const members = ["sdks/python", "packages/ksuid-python"];

const rootPyproject = () => readFileSync(join(root, "pyproject.toml"), "utf8");

describe("python uv workspace", () => {
  describe("when the root pyproject is read", () => {
    /** @scenario "The workspace root declares the Python members" */
    it("is virtual and lists the members", () => {
      const content = rootPyproject();
      expect(content).toContain("[tool.uv.workspace]");
      for (const member of members) {
        expect(content).toContain(`"${member}"`);
      }
      // Virtual root: nothing builds or publishes from the repository root.
      expect(content).not.toContain("[project]");
      expect(content).not.toContain("[build-system]");
      expect(existsSync(join(root, "uv.lock"))).toBe(true);
    });
  });

  describe("when the member directories are inspected", () => {
    /** @scenario "Workspace members carry no lockfile of their own" */
    it("finds no member uv.lock", () => {
      for (const member of members) {
        expect(
          existsSync(join(root, member, "uv.lock")),
          `${member}/uv.lock must not exist — the workspace root lock is the only one`,
        ).toBe(false);
      }
    });
  });

  describe("when the member pyprojects are read", () => {
    /** @scenario "Resolution settings live only at the workspace root" */
    it("keeps resolution settings out of members and the pins at the root", () => {
      for (const member of members) {
        const content = readFileSync(join(root, member, "pyproject.toml"), "utf8");
        const uncommented = content
          .split("\n")
          .filter((line) => !line.trimStart().startsWith("#"))
          .join("\n");
        expect(
          uncommented,
          `${member} must not declare exclude-newer — uv ignores it on members`,
        ).not.toContain("exclude-newer");
        expect(
          uncommented,
          `${member} must not declare constraint-dependencies — uv ignores them on members`,
        ).not.toContain("constraint-dependencies");
      }
      expect(rootPyproject()).toContain("constraint-dependencies");
    });
  });

  describe("when the root pyproject declares lock environments", () => {
    /** @scenario "A lock narrower than the members' Python range is declared at the root" */
    it("only raises the Python floor, and .python-version asks for at least it", () => {
      const declared = rootPyproject().match(/^environments\s*=\s*\[([^\]]*)\]/m);
      if (!declared) return;
      const entries = [...(declared[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
      expect(entries.length).toBeGreaterThan(0);
      const floors = entries.map((entry) => {
        const floor = entry.match(
          /^python_full_version >= '(\d+\.\d+\.\d+)'( and sys_platform != '[a-z0-9_]+')*$/,
        );
        expect(
          floor,
          `environment "${entry}" may only raise the Python floor or drop a platform`,
        ).not.toBeNull();
        return floor?.[1] ?? "";
      });
      const highest = floors.toSorted(compareVersions).at(-1) ?? "";
      for (const dir of [".", "sdks/python"]) {
        const request = readFileSync(join(root, dir, ".python-version"), "utf8").trim();
        const lower = request.match(/>=\s*(\d+\.\d+\.\d+)/)?.[1];
        expect(lower, `${dir}/.python-version must ask for >=${highest}`).toBeDefined();
        expect(compareVersions(lower ?? "0.0.0", highest)).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
