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
});
