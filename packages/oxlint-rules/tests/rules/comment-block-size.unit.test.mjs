import { afterAll, describe, expect, it } from "vitest";

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
      expect(found[0].message).toBe(
        "Comment block has 9 lines; the maximum is 5. Delete it when the code already says it," +
          " or move the narrative into an ADR under `dev/docs/adr/` and leave one line here" +
          " linking it. See ADR-140.",
      );
    });
  });

  describe("when an oversized block carries a @lint-keep annotation", () => {
    /** @scenario "The keep annotation does not suppress the error" */
    it("still reports the block", () => {
      const keep = "// @lint-keep the ordering table is the contract dev/docs/adr/140-x.md";
      const code = `${commentLines(8)}\n${keep}\nexport const x = 1;`;
      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("commentBlockSize");
    });
  });

  describe("when a block carries two keep lines beside five lines of prose", () => {
    /** @scenario "A keep annotation's lines count as commentary" */
    it("reports all seven lines at the block's first line", () => {
      const keep = "// @lint-keep the ordering table is the contract dev/docs/adr/140-x.md";
      const code = `export const before = 0;\n${commentLines(5)}\n${keep}\n${keep}\nexport const x = 1;`;
      const found = report(code);

      expect(found.map((entry) => [entry.data.lines, entry.line])).toEqual([[7, 2]]);
    });
  });

  describe("when a block is exactly the maximum", () => {
    /** @scenario "A five-line block is at the maximum and passes" */
    it("reports nothing", () => {
      expect(report(`${commentLines(5)}\nexport const x = 1;`)).toEqual([]);
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
          " Wrap it at 100 columns, keeping the sentence whole across the break. If it only" +
          " restates the code beside it, delete it instead of wrapping it.",
      );
    });
  });

  describe("when an overlong comment line is a scenario binding", () => {
    /** @scenario "An overlong scenario binding is not reported" */
    it("reports nothing, because the title cannot be rewrapped", () => {
      const wide = `/** @scenario "${"x".repeat(120)}" */`;

      expect(report(`${wide}\nexport const x = 1;`)).toEqual([]);
    });
  });

  describe("when a block's length is its @param tags rather than prose", () => {
    /** @scenario "Structural JSDoc tags are not counted as commentary" */
    it("reports nothing, because the tag count comes from the signature", () => {
      const code = [
        "/**",
        " * Sends the batch.",
        " * @param one the first",
        " * @param two the second",
        " * @param three the third",
        " * @param four the fourth",
        " * @returns the receipt",
        " */",
        "export const x = 1;",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a block's length is a test's level and environment annotations", () => {
    /** @scenario "A test's level and environment annotations are not counted as commentary" */
    it("reports nothing, because neither annotation can be deleted by its author", () => {
      const code = [
        "/**",
        " * Runs the generated SQL against the shipped migrations.",
        " * @see specs/analytics/clickhouse-memory-safety.feature",
        " * @integration",
        " * @vitest-environment node",
        " */",
        "export const x = 1;",
      ].join("\n");

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a block has prose bulk beyond its tags", () => {
    /** @scenario "Prose past the limit is still reported alongside tags" */
    it("reports the block, counting only the commentary", () => {
      const prose = Array.from({ length: 9 }, (_, i) => ` * narrative line ${i}`).join("\n");
      const code = `/**\n${prose}\n * @param one the first\n */\nexport const x = 1;`;
      const found = report(code);

      expect(found).toHaveLength(1);
      expect(found[0].data.lines).toBe(11);
    });
  });

  describe("when the block sits under the maximum", () => {
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
