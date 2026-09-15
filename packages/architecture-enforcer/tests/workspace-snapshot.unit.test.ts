/**
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";
import { moduleImports, sourceFile, sourceText } from "../src/workspace/module-graph.ts";
import { walkFiles } from "../src/workspace/layout.ts";

let root: string;

function write(file: string, text: string): void {
  const target = join(root, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "workspace-snapshot-"));
  write("packages/widget/package.json", JSON.stringify({ name: "@langwatch/widget" }));
  write("packages/widget/src/index.ts", 'export { rate } from "./rate.ts";\n');
  write("packages/widget/src/rate.ts", "export const rate = 3;\n");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("given a workspace snapshot", () => {
  describe("when two policies ask for the same directory", () => {
    it("answers both from one walk, and filters each caller's own way", () => {
      const snapshot = buildWorkspaceSnapshot({ root, changedFiles: [] });
      const directory = join(root, "packages/widget/src");

      const all = snapshot.files({ directory, accept: () => true });
      const entries = snapshot.files({ directory, accept: (file) => file.endsWith("index.ts") });

      expect(all).toEqual([join(directory, "index.ts"), join(directory, "rate.ts")]);
      expect(entries).toEqual([join(directory, "index.ts")]);
    });

    it("does not see a file written after it was built", () => {
      const snapshot = buildWorkspaceSnapshot({ root, changedFiles: [] });
      const directory = join(root, "packages/widget/src");
      snapshot.files({ directory, accept: () => true });

      write("packages/widget/src/late.ts", "export const late = 1;\n");

      expect(snapshot.files({ directory, accept: () => true })).toHaveLength(2);
      expect(walkFiles(directory, () => true)).toHaveLength(3);
    });
  });

  describe("when it is built", () => {
    it("carries the classified packages, the catalogue and the resolver", () => {
      const snapshot = buildWorkspaceSnapshot({ root, changedFiles: ["a.ts"] });

      expect(snapshot.root).toBe(root);
      expect(snapshot.changedFiles).toEqual(["a.ts"]);
      expect(snapshot.catalogue).toEqual([]);
      expect(
        snapshot.resolver.resolve({
          specifier: "./rate.ts",
          file: join(root, "packages/widget/src/index.ts"),
        }),
      ).toBe(join(root, "packages/widget/src/rate.ts"));
    });
  });
});

describe("given one file read by more than one policy", () => {
  describe("when the syntax tree is asked for twice", () => {
    it("returns the same tree, and a fresh one once the file changes", () => {
      const file = join(root, "packages/widget/src/rate.ts");

      const first = sourceFile({ file });
      expect(sourceFile({ file })).toBe(first);

      writeFileSync(file, "export const rate = 4;\nexport const other = 5;\n");

      const second = sourceFile({ file });
      expect(second).not.toBe(first);
      expect(sourceText({ file })).toContain("other");
    });
  });

  describe("when a policy needs parent links and another does not", () => {
    it("reuses the tree that has them rather than parsing twice", () => {
      const file = join(root, "packages/widget/src/index.ts");

      const withParents = sourceFile({ file, parents: true });

      expect(sourceFile({ file, parents: false })).toBe(withParents);
      expect(moduleImports({ file })[0]?.specifier).toBe("./rate.ts");
    });
  });
});
