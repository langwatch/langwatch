import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { changedSourceFiles, lintCommentBlocks } from "../src";

function lineComments(lines: number): string {
  return Array.from({ length: lines }, () => "// comment").join("\n");
}

function blockComment(lines: number): string {
  if (lines === 1) return "/* comment */";
  return ["/*", ...Array.from({ length: lines - 2 }, () => " * comment"), " */"].join(
    "\n",
  );
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
  it("queues adjacent line and block comments at the soft threshold", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-adjacent-"));
    writeFixture(root, "src/adjacent.ts", `${lineComments(14)}\n${blockComment(16)}`);

    expect(lintCommentBlocks(root)).toEqual({
      reviews: [
        {
          category: "comment-blocks",
          file: "src/adjacent.ts",
          line: 1,
          lines: 30,
          message: "Comment block has 30 lines and should receive review attention.",
        },
      ],
      violations: [],
    });
  });

  it("keeps 29 lines quiet, queues 30 through 60, and fails at 61", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-boundaries-"));
    writeFixture(root, "src/twenty-nine.ts", lineComments(29));
    writeFixture(root, "src/thirty.ts", lineComments(30));
    writeFixture(root, "src/sixty.ts", blockComment(60));
    writeFixture(root, "src/sixty-one.ts", blockComment(61));

    const result = lintCommentBlocks(root);
    expect(result.reviews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ file: "src/thirty.ts", line: 1, lines: 30 }),
        expect.objectContaining({ file: "src/sixty.ts", line: 1, lines: 60 }),
      ]),
    );
    expect(result.violations).toMatchObject([
      {
        policy: "comment-block-size",
        file: join(root, "src/sixty-one.ts"),
        line: 1,
      },
    ]);
  });

  it("does not merge blocks separated by a blank line or count code-line comments", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-contiguous-"));
    writeFixture(root, "src/separated.ts", `${lineComments(29)}\n\n${lineComments(29)}`);
    writeFixture(
      root,
      "src/code.ts",
      `${Array.from({ length: 61 }, () => "const value = 1; // comment").join("\n")}`,
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
        ...Array.from({ length: 61 }, (_, index) => `const item${index} = ${index};`),
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
    writeFixture(root, "src/base.ts", lineComments(61));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "base");
    git(root, "checkout", "--quiet", "-b", "comment-blocks");

    writeFixture(root, "src/committed.ts", lineComments(61));
    git(root, "add", ".");
    git(root, "commit", "--quiet", "-m", "committed change");
    writeFixture(root, "src/current.ts", lineComments(61));
    writeFixture(root, "src/untracked.ts", lineComments(61));

    const files = changedSourceFiles(root);
    expect(files.map((file) => file.slice(root.length + 1))).toEqual([
      "src/committed.ts",
      "src/current.ts",
      "src/untracked.ts",
    ]);
    expect(lintCommentBlocks(root, { files }).violations).toHaveLength(3);
  });

  it("ignores licences, generated headers, generated files, and build output", () => {
    const root = mkdtempSync(join(tmpdir(), "comment-blocks-exclusions-"));
    writeFixture(
      root,
      "src/licensed.ts",
      `// SPDX-License-Identifier: Apache-2.0\n${lineComments(61)}`,
    );
    writeFixture(
      root,
      "src/copyright.ts",
      `/* Copyright 2026 LangWatch. Licensed under Apache-2.0. */\n${lineComments(61)}`,
    );
    writeFixture(
      root,
      "src/generated-header.ts",
      `// Code generated by test. DO NOT EDIT.\n${lineComments(61)}`,
    );
    writeFixture(root, "src/schema.generated.ts", lineComments(61));
    writeFixture(root, "vendor/vendor.ts", lineComments(61));
    writeFixture(root, "generated/generated.ts", lineComments(61));
    writeFixture(root, "build/build.ts", lineComments(61));

    expect(lintCommentBlocks(root)).toEqual({ reviews: [], violations: [] });
  });
});
