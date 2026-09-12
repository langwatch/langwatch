import { execFileSync } from "node:child_process";
import { afterAll, describe, expect, it } from "vitest";
import { commentBlockSizeMessage } from "../../grammar/comment-block-policy.mjs";
import { commentBlockSizeRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, filename = "packages/x/src/y.ts") {
  return runRule(commentBlockSizeRule, { code, cwd: workspace.cwd, filename });
}

function commentLines(count) {
  return Array.from(
    { length: count },
    (_, i) => `// review line ${i} of the block explaining why`,
  ).join("\n");
}

describe("given a source file outside the burn-down allowlist", () => {
  describe("when a comment block has 9 or more lines", () => {
    /** @scenario "An oversized comment block is reported with its measured line count" */
    it("reports the block size message", () => {
      const found = report(`${commentLines(9)}\nexport const x = 1;`);

      expect(found).toHaveLength(1);
      expect(found[0].message).toBe(commentBlockSizeMessage(9));
      expect(found[0].message).toContain("Comment block has 9 lines; the maximum is 5.");
      expect(found[0].message).toContain("haiku subagent");
    });
  });

  describe("when a comment line is wider than 100 columns", () => {
    /** @scenario "An overlong comment line is reported with its measured width" */
    it("reports commentColumns with the width", () => {
      const wide = `// ${"x".repeat(120)}`;
      const found = report(`${wide}\nexport const x = 1;`);

      expect(found.map((entry) => entry.messageId)).toEqual(["commentColumns"]);
      expect(found[0].data.width).toBe(wide.length);
      expect(found[0].message).toBe(
        `Comment line is ${wide.length} columns; wrap at 100.` +
          " Rewrap the block at 100 columns, or cut it to the sentence that earns its place.",
      );
    });
  });

  describe("when the block sits under the warn threshold", () => {
    /** @scenario "A comment block under the size thresholds is left alone" */
    it("reports nothing", () => {
      expect(report(`${commentLines(2)}\nexport const x = 1;`)).toEqual([]);
    });
  });

  describe("when the block carries a @scenario annotation", () => {
    /** @scenario "A scenario-bound comment block is exempt from the size limit" */
    it("reports nothing even at 9 lines", () => {
      const code = `/** @scenario "x" */\n${commentLines(9)}\nexport const x = 1;`;

      expect(report(code)).toEqual([]);
    });
  });
});

describe("given a file the burn-down allowlist covers", () => {
  describe("when the same file has an oversized block", () => {
    /** @scenario "A file the burn-down root covers is not reported" */
    it("reports nothing", () => {
      // The coverage check only applies inside a git checkout — outside one,
      // "every file counts as changed", which never matches an allowlist
      // root. A throwaway repo, committed once, is what lets this branch run
      // at all.
      const covered = createFixtureWorkspace({
        files: {
          "packages/architecture-lint/src/comment-block-roots.json": JSON.stringify({
            version: 0,
            roots: [{ root: "legacy", expires: "2999-01-01" }],
          }),
          "legacy/module.ts": `${commentLines(9)}\nexport const x = 1;`,
        },
      });
      const git = (...arguments_) =>
        execFileSync("git", ["-C", covered.cwd, ...arguments_], { stdio: "ignore" });
      try {
        git("init", "-q");
        git("-c", "user.email=lint@langwatch.ai", "-c", "user.name=lint", "add", "-A");
        git(
          "-c",
          "user.email=lint@langwatch.ai",
          "-c",
          "user.name=lint",
          "-c",
          "commit.gpgsign=false",
          "commit",
          "-q",
          "-m",
          "fixture",
        );

        const found = runRule(commentBlockSizeRule, {
          code: `${commentLines(9)}\nexport const x = 1;`,
          cwd: covered.cwd,
          filename: "legacy/module.ts",
        });

        expect(found).toEqual([]);
      } finally {
        covered.cleanup();
      }
    });
  });
});
