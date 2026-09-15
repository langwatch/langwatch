import { afterAll, describe, expect, it } from "vitest";
import { commentBlockSizeWarningRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(commentBlockSizeWarningRule, {
    code,
    cwd: workspace.cwd,
    filename: "packages/x/src/y.ts",
  });
}

function commentLines(count) {
  return Array.from(
    { length: count },
    (_, i) => `// review line ${i} of the block explaining why`,
  ).join("\n");
}

describe("given a comment block between 6 and 8 lines", () => {
  describe("when it is not yet at the error threshold", () => {
    /** @scenario "A mid-size comment block is warned about with the measured count" */
    it("reports commentBlockSize at warning severity", () => {
      const found = report(`${commentLines(7)}\nexport const x = 1;`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("commentBlockSize");
      expect(found[0].data).toEqual({ error: 9, lines: 7, max: 5, words: 3 });
    });

    /** @scenario "The warning names the real 5-line maximum, not the 9-line error threshold" */
    it("says trimming under 9 lines does not itself clear the warning", () => {
      const found = report(`${commentLines(7)}\nexport const x = 1;`);

      expect(found[0].message).toContain("The real maximum is 5");
      expect(found[0].message).toContain("Trimming to under 9 lines does not clear this warning");
      expect(found[0].message).toContain("only 5 lines or fewer does");
    });
  });

  describe("when it carries a @lint-keep naming the ADR that records it", () => {
    /** @scenario "A keep annotation naming its ADR silences the warning" */
    it("reports nothing", () => {
      const keep = "// @lint-keep the ordering table is the contract dev/docs/adr/140-x.md";
      const code = `${commentLines(7)}\n${keep}\nexport const x = 1;`;

      expect(report(code)).toEqual([]);
    });
  });

  describe("when a @lint-keep gives a reason but names no ADR", () => {
    /** @scenario "A keep annotation that records nothing is refused" */
    it("reports commentKeepReason", () => {
      const code = `${commentLines(7)}\n// @lint-keep the ordering table is the contract\nexport const x = 1;`;

      expect(report(code).map((entry) => entry.messageId)).toEqual(["commentKeepReason"]);
    });
  });

  describe("when it carries a @lint-keep annotation with no reason", () => {
    /** @scenario "A keep annotation with no reason is refused" */
    it("reports commentKeepReason instead of the size message", () => {
      const found = report(`${commentLines(7)}\n// @lint-keep\nexport const x = 1;`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("commentKeepReason");
      expect(found[0].data).toEqual({ error: 9, lines: 7, max: 5, words: 3 });
    });
  });

  describe("when the @lint-keep reason is too short to be a reason", () => {
    /** @scenario "A keep annotation whose reason is a single word is refused" */
    it("reports commentKeepReason", () => {
      const keep = "// @lint-keep legacy dev/docs/adr/140-x.md";
      const found = report(`${commentLines(7)}\n${keep}\nexport const x = 1;`);

      expect(found.map((entry) => entry.messageId)).toEqual(["commentKeepReason"]);
    });
  });

  describe("when the block is 9 lines or more", () => {
    /** @scenario "An oversized block is left to the error-severity rule" */
    it("reports nothing (the size rule owns it)", () => {
      expect(report(`${commentLines(9)}\nexport const x = 1;`)).toEqual([]);
    });
  });
});
