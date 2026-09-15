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
      expect(found[0].data).toEqual({ lines: 7, max: 5 });
    });
  });

  describe("when the block is 9 lines or more", () => {
    /** @scenario "An oversized block is left to the error-severity rule" */
    it("reports nothing (the size rule owns it)", () => {
      expect(report(`${commentLines(9)}\nexport const x = 1;`)).toEqual([]);
    });
  });
});
