import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  changedSourceFiles,
  COMMENT_BLOCK_ROOTS_BASELINE,
  lintCommentBlockRoots,
  lintCommentBlocks,
  shrinkCheck,
} from "../src/index.ts";
import type { BaselineEntry } from "../src/index.ts";
import { Temporal } from "@langwatch/time";

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
  it("queues 4 and 5 line blocks, leaving 3 quiet and 6 and up to langwatch/comment-block-size", () => {
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
    expect(result.reviews.map((review) => review.file)).not.toEqual(
      expect.arrayContaining(["src/three.ts", "src/six.ts"]),
    );
  });

  it("does not merge blocks separated by a blank line or count code-line comments", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-contiguous-"));
    writeFixture(root, "src/separated.ts", `${lineComments(3)}\n\n${lineComments(3)}`);
    writeFixture(
      root,
      "src/code.ts",
      `${Array.from({ length: 6 }, () => "const value = 1; // comment").join("\n")}`,
    );

    expect(lintCommentBlocks(root)).toEqual({ reviews: [] });
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

    expect(lintCommentBlocks(root)).toEqual({ reviews: [] });
  });

  it("checks committed branch changes, current changes, and untracked source only", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-changed-files-"));
    git(root, "init", "--quiet", "--initial-branch=main");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Architecture Lint Test");
    git(root, "config", "commit.gpgsign", "false");
    writeFixture(root, "src/base.ts", lineComments(4));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "base");
    git(root, "checkout", "--quiet", "-b", "comment-blocks");

    writeFixture(root, "src/committed.ts", lineComments(4));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "committed change");
    writeFixture(root, "src/current.ts", lineComments(4));
    writeFixture(root, "src/untracked.ts", lineComments(4));

    const files = changedSourceFiles(root);
    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      "src/committed.ts",
      "src/current.ts",
      "src/untracked.ts",
    ]);
  });

  it("does not scan the 4-5 line review tier outside changed files", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-unchanged-warn-"));
    writeFixture(root, "packages/other/src/four.ts", lineComments(4));

    expect(lintCommentBlocks(root, { changedFiles: [] })).toEqual({ reviews: [] });
  });

  describe("comment-block-roots.json (R1)", () => {
    function rootsDocument(entries: readonly unknown[]): unknown {
      return { version: 1, policy: "comment-block-root", entries };
    }

    /** The root has to be a real directory: a row naming a deleted one is stale. */
    function writeRootsFile(root: string, entries: readonly BaselineEntry[]): void {
      for (const entry of entries) mkdirSync(join(root, entry.key), { recursive: true });

      writeFixture(
        root,
        "packages/architecture-enforcer/src/comment-block-roots.json",
        JSON.stringify(rootsDocument(entries)),
      );
    }

    const legacy = { key: "packages/legacy", measured: "2026-09-08" };

    /** @scenario "An expired row is refused where the policy enforces its date" */
    it("reports an expired entry", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-expired-"));
      writeRootsFile(root, [{ ...legacy, expires: "2020-01-01", count: 10 }]);

      const check = lintCommentBlockRoots(
        root,
        void 0,
        Temporal.Instant.from("2026-01-01T00:00:00Z"),
      );

      expect(check.violations).toMatchObject([{ policy: "comment-block-root-expired" }]);
    });

    it("stays quiet for an entry that has not expired", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-fresh-"));
      writeRootsFile(root, [{ ...legacy, expires: "2099-01-01", count: 10 }]);

      const check = lintCommentBlockRoots(
        root,
        void 0,
        Temporal.Instant.from("2026-01-01T00:00:00Z"),
      );

      expect(check.violations).toEqual([]);
      expect(check.entries).toEqual([{ ...legacy, expires: "2099-01-01", count: 10 }]);
    });

    /** @scenario "A row no live finding matches is reported as stale" */
    it("reports a row naming a directory that is gone", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-stale-"));
      writeFixture(
        root,
        "packages/architecture-enforcer/src/comment-block-roots.json",
        JSON.stringify(rootsDocument([{ ...legacy, expires: "2099-01-01", count: 10 }])),
      );

      const check = lintCommentBlockRoots(
        root,
        void 0,
        Temporal.Instant.from("2026-01-01T00:00:00Z"),
      );

      expect(check.violations).toMatchObject([
        { policy: "comment-block-root-baseline", stale: true },
      ]);
    });

    it("rejects growth against a merge-base reference: a raised block count, a later expiry, or a new root", () => {
      const root = mkdtempSync(join(tmpdir(), "comment-block-roots-growth-"));
      writeRootsFile(root, [
        { ...legacy, expires: "2099-02-01", count: 20 },
        { key: "packages/new", measured: "2026-09-08", expires: "2099-01-01", count: 5 },
      ]);
      writeFixture(
        root,
        "reference/comment-block-roots.json",
        JSON.stringify(rootsDocument([{ ...legacy, expires: "2099-01-01", count: 10 }])),
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
      writeRootsFile(root, [{ ...legacy, expires: "2099-01-01", count: 5 }]);
      writeFixture(
        root,
        "reference/comment-block-roots.json",
        JSON.stringify(
          rootsDocument([
            { key: "packages/gone", measured: "2026-09-08", expires: "2099-01-01", count: 3 },
            { ...legacy, expires: "2099-02-01", count: 10 },
          ]),
        ),
      );

      const check = lintCommentBlockRoots(root, "reference/comment-block-roots.json");

      expect(check.violations).toEqual([]);
    });

    /** @scenario "A shrink check refuses a raised count and a postponed date" */
    it("compares reference and proposed allowlists directly", () => {
      const violations = shrinkCheck({
        reference: [{ ...legacy, expires: "2099-01-01", count: 10 }],
        current: [{ ...legacy, expires: "2099-01-01", count: 11 }],
        policy: COMMENT_BLOCK_ROOTS_BASELINE,
        file: "comment-block-roots.json",
      });

      expect(violations).toMatchObject([{ policy: "comment-block-root-baseline-growth" }]);
    });
  });

  it("ignores licences, generated headers, generated files, and build output", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-exclusions-"));
    writeFixture(
      root,
      "src/licensed.ts",
      `// SPDX-License-Identifier: Apache-2.0\n${lineComments(4)}`,
    );
    writeFixture(
      root,
      "src/copyright.ts",
      `/* Copyright 2026 LangWatch. Licensed under Apache-2.0. */\n${lineComments(4)}`,
    );
    writeFixture(
      root,
      "src/generated-header.ts",
      `// Code generated by test. DO NOT EDIT.\n${lineComments(4)}`,
    );
    writeFixture(root, "src/schema.generated.ts", lineComments(4));
    writeFixture(root, "vendor/vendor.ts", lineComments(4));
    writeFixture(root, "generated/generated.ts", lineComments(4));
    writeFixture(root, "build/build.ts", lineComments(4));

    expect(lintCommentBlocks(root)).toEqual({ reviews: [] });
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

    const { reviews } = lintCommentBlocks(root);

    expect(reviews).toMatchObject([
      { category: "comment-blocks", file: "src/jsdoc.ts", line: 1, lines: 5 },
    ]);
    expect(reviews[0]?.message).toContain("Comment block has 5 lines, at the 5-line limit.");
    expect(reviews[0]?.message).toContain("haiku-subagent sweep");
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

    expect(lintCommentBlocks(root)).toEqual({ reviews: [] });
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

    expect(lintCommentBlocks(root)).toEqual({ reviews: [] });
  });

  it("covers apps/ as a scanned source root, not only packages/", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-apps-root-"));
    writeFixture(root, "apps/api/src/app/example.composition.ts", blockComment(5));

    expect(lintCommentBlocks(root).reviews).toMatchObject([
      { category: "comment-blocks", file: "apps/api/src/app/example.composition.ts", line: 1 },
    ]);
  });
});
