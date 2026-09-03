import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedSourceFiles,
  compareCommentBlockRoots,
  lintCommentBlockRoots,
  lintCommentBlocks,
} from "../src";

function lineComments(lines: number): string {
  return Array.from({ length: lines }, () => "// comment").join("\n");
}

function blockComment(lines: number): string {
  if (lines === 1) return "/* comment */";
  return ["/*", ...Array.from({ length: lines - 2 }, () => " * comment"), " */"].join("\n");
}

function writeFixture(root: string, file: string, source: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${source}\n`);
}

function git(root: string, ...arguments_: string[]): void {
  execFileSync("git", ["-C", root, ...arguments_], { stdio: "ignore" });
}

describe("oversized comment blocks", () => {
  it("keeps 3 lines quiet, warns at 4 lines (over 3), and errors at 6 lines (over 5)", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-boundaries-"));
    writeFixture(root, "src/three.ts", lineComments(3));
    writeFixture(root, "src/four.ts", lineComments(4));
    writeFixture(root, "src/five.ts", blockComment(5));
    writeFixture(root, "src/six.ts", blockComment(6));

    const result = lintCommentBlocks(root);
    expect(result.reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/four.ts", line: 1, lines: 4 }),
        expect.objectContaining({ file: "src/five.ts", line: 1, lines: 5 }),
      ]),
    );
    expect(result.reviews).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ file: "src/three.ts" })]),
    );
    expect(result.violations).toMatchObject([
      {
        policy: "comment-block-size",
        file: join(root, "src/six.ts"),
        line: 1,
      },
    ]);
  });

  it("does not merge blocks separated by a blank line or count code-line comments", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-contiguous-"));
    writeFixture(root, "src/separated.ts", `${lineComments(3)}\n\n${lineComments(3)}`);
    writeFixture(
      root,
      "src/code.ts",
      `${Array.from({ length: 6 }, () => "const value = 1; // comment").join("\n")}`,
    );

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });

  it("does not mistake a template tail for a block comment", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-template-tail-"));
    writeFixture(
      root,
      "src/template-tail.ts",
      [
        'const value = "guard";',
        "const pattern = `${value}/*`;",
        ...Array.from({ length: 6 }, (_, index) => `const item${index} = ${index};`),
      ].join("\n"),
    );

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });

  it("checks committed branch changes, current changes, and untracked source only", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-changed-files-"));
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Architecture Lint Test");
    git(root, "config", "commit.gpgsign", "false");
    writeFixture(root, "src/base.ts", lineComments(6));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "base");
    git(root, "checkout", "--quiet", "-b", "comment-blocks");

    writeFixture(root, "src/committed.ts", lineComments(6));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "committed change");
    writeFixture(root, "src/current.ts", lineComments(6));
    writeFixture(root, "src/untracked.ts", lineComments(6));

    const files = changedSourceFiles(root);
    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      "src/committed.ts",
      "src/current.ts",
      "src/untracked.ts",
    ]);
    expect(lintCommentBlocks(root, { files }).violations).toHaveLength(3);
  });

  describe("the whole-repo root allowlist (R1)", () => {
    it("errors on 6+ lines in a changed file always, even under an allowed root", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-blocks-changed-always-"));
      writeFixture(root, "packages/legacy/src/six.ts", blockComment(6));

      const result = lintCommentBlocks(root, {
        changedFiles: ["packages/legacy/src/six.ts"],
        allowedRoots: [{ root: "packages/legacy", blocks: 1, expires: "2099-01-01" }],
      });

      expect(result.violations).toMatchObject([
        { policy: "comment-block-size", file: join(root, "packages/legacy/src/six.ts") },
      ]);
    });

    it("exempts 6+ lines in an unchanged file whose root is allowed and unexpired", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-blocks-allowed-root-"));
      writeFixture(root, "packages/legacy/src/six.ts", blockComment(6));
      writeFixture(root, "packages/other/src/six.ts", blockComment(6));

      const result = lintCommentBlocks(root, {
        changedFiles: [],
        allowedRoots: [{ root: "packages/legacy", blocks: 1, expires: "2099-01-01" }],
        now: new Date("2026-01-01T00:00:00Z"),
      });

      expect(result.violations).toMatchObject([
        { policy: "comment-block-size", file: join(root, "packages/other/src/six.ts") },
      ]);
    });

    it("stops exempting an unchanged file once its root's allowlist entry has expired", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-blocks-expired-root-"));
      writeFixture(root, "packages/legacy/src/six.ts", blockComment(6));

      const result = lintCommentBlocks(root, {
        changedFiles: [],
        allowedRoots: [{ root: "packages/legacy", blocks: 1, expires: "2020-01-01" }],
        now: new Date("2026-01-01T00:00:00Z"),
      });

      expect(result.violations).toMatchObject([
        { policy: "comment-block-size", file: join(root, "packages/legacy/src/six.ts") },
      ]);
    });

    it("does not scan the 4-5 line warn tier outside changed files", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-blocks-unchanged-warn-"));
      writeFixture(root, "packages/other/src/four.ts", lineComments(4));

      const result = lintCommentBlocks(root, { changedFiles: [] });

      expect(result.reviews).toEqual([]);
      expect(result.violations).toEqual([]);
    });
  });

  describe("comment-block-roots.json (R1)", () => {
    function writeRootsFile(root: string, contents: unknown): void {
      writeFixture(
        root,
        "packages/architecture-lint/src/comment-block-roots.json",
        JSON.stringify(contents),
      );
    }

    it("reports an expired entry", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-expired-"));
      writeRootsFile(root, {
        version: 0,
        roots: [{ root: "packages/legacy", blocks: 10, expires: "2020-01-01" }],
      });

      const check = lintCommentBlockRoots(root, void 0, new Date("2026-01-01T00:00:00Z"));

      expect(check.violations).toMatchObject([{ policy: "comment-block-root-expired" }]);
    });

    it("stays quiet for an entry that has not expired", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-fresh-"));
      writeRootsFile(root, {
        version: 0,
        roots: [{ root: "packages/legacy", blocks: 10, expires: "2099-01-01" }],
      });

      const check = lintCommentBlockRoots(root, void 0, new Date("2026-01-01T00:00:00Z"));

      expect(check.violations).toEqual([]);
      expect(check.entries).toEqual([
        { root: "packages/legacy", blocks: 10, expires: "2099-01-01" },
      ]);
    });

    it("rejects growth against a merge-base reference: a raised block count, a later expiry, or a new root", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-growth-"));
      writeRootsFile(root, {
        version: 0,
        roots: [
          { root: "packages/legacy", blocks: 20, expires: "2099-02-01" },
          { root: "packages/new", blocks: 5, expires: "2099-01-01" },
        ],
      });
      writeFixture(
        root,
        "reference/comment-block-roots.json",
        JSON.stringify({
          version: 0,
          roots: [{ root: "packages/legacy", blocks: 10, expires: "2099-01-01" }],
        }),
      );

      const check = lintCommentBlockRoots(root, "reference/comment-block-roots.json");

      expect(check.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            policy: "comment-block-root-baseline-growth",
            message: expect.stringContaining("increase packages/legacy's block count"),
          }),
          expect.objectContaining({
            policy: "comment-block-root-baseline-growth",
            message: expect.stringContaining("move packages/legacy's expiry later"),
          }),
          expect.objectContaining({
            policy: "comment-block-root-baseline-growth",
            message: expect.stringContaining("cannot add packages/new"),
          }),
        ]),
      );
    });

    it("accepts shrinking the allowlist against a reference: a lower count, an earlier expiry, or a dropped root", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-shrink-"));
      writeRootsFile(root, {
        version: 0,
        roots: [{ root: "packages/legacy", blocks: 5, expires: "2099-01-01" }],
      });
      writeFixture(
        root,
        "reference/comment-block-roots.json",
        JSON.stringify({
          version: 0,
          roots: [
            { root: "packages/legacy", blocks: 10, expires: "2099-02-01" },
            { root: "packages/gone", blocks: 3, expires: "2099-01-01" },
          ],
        }),
      );

      const check = lintCommentBlockRoots(root, "reference/comment-block-roots.json");

      expect(check.violations).toEqual([]);
    });

    it("compares reference and proposed allowlists directly", () => {
      const violations = compareCommentBlockRoots(
        [{ root: "packages/legacy", blocks: 10, expires: "2099-01-01" }],
        [{ root: "packages/legacy", blocks: 11, expires: "2099-01-01" }],
        "comment-block-roots.json",
      );

      expect(violations).toMatchObject([{ policy: "comment-block-root-baseline-growth" }]);
    });
  });

  it("ignores licences, generated headers, generated files, and build output", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-exclusions-"));
    writeFixture(
      root,
      "src/licensed.ts",
      `// SPDX-License-Identifier: Apache-2.0\n${lineComments(6)}`,
    );
    writeFixture(
      root,
      "src/copyright.ts",
      `/* Copyright 2026 LangWatch. Licensed under Apache-2.0. */\n${lineComments(6)}`,
    );
    writeFixture(
      root,
      "src/generated-header.ts",
      `// Code generated by test. DO NOT EDIT.\n${lineComments(6)}`,
    );
    writeFixture(root, "src/schema.generated.ts", lineComments(6));
    writeFixture(root, "vendor/vendor.ts", lineComments(6));
    writeFixture(root, "generated/generated.ts", lineComments(6));
    writeFixture(root, "build/build.ts", lineComments(6));

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });

  it("counts a JSDoc block toward the same thresholds as a plain block comment", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-jsdoc-"));
    const jsdoc = [
      "/**",
      " * Line one of an explanation.",
      " * Line two of an explanation.",
      " * Line three of an explanation.",
      " */",
    ].join("\n");
    writeFixture(root, "src/jsdoc.ts", `${jsdoc}\nexport const value = 1;`);

    expect(lintCommentBlocks(root)).toEqual({
      reviews: [
        {
          category: "comment-blocks",
          file: "src/jsdoc.ts",
          line: 1,
          lines: 5,
          message: "Comment block has 5 lines and should receive review attention.",
        },
      ],
      violations: [],
    });
  });

  it("exempts a JSDoc block carrying a @scenario annotation regardless of length", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-scenario-"));
    const jsdoc = [
      "/**",
      ' * @scenario "A definition map becomes a JSON Schema object"',
      " * Extra line one.",
      " * Extra line two.",
      " * Extra line three.",
      " * Extra line four.",
      " */",
    ].join("\n");
    writeFixture(root, "src/scenario.ts", `${jsdoc}\nit("works", () => {});`);

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });

  it("exempts a block that is only eslint/oxlint/@ts- directives", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-directives-"));
    writeFixture(
      root,
      "src/directives.ts",
      [
        "// eslint-disable-next-line no-console",
        "// oxlint-disable-next-line no-unused-vars",
        "// @ts-expect-error legacy shape",
        "// eslint-disable-next-line max-len",
        "// oxlint-disable-next-line no-empty",
        "// @ts-ignore third-party types",
        "export const value = 1;",
      ].join("\n"),
    );

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });

  it("covers apps/ as a scanned source root, not only packages/", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-apps-root-"));
    writeFixture(root, "apps/api/src/app/example.composition.ts", blockComment(6));

    const result = lintCommentBlocks(root);
    expect(result.violations).toMatchObject([
      {
        policy: "comment-block-size",
        file: join(root, "apps/api/src/app/example.composition.ts"),
        line: 1,
      },
    ]);
  });
});
