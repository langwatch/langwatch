import { afterAll, describe, expect, it } from "vitest";
import { booleanWallRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(booleanWallRule, { code, cwd: workspace.cwd, filename: "x.ts" });
}

describe("given a logical expression", () => {
  describe("when it has more than three leaf conditions", () => {
    /** @scenario "A boolean wall is reported with its measured leaf count" */
    it("reports booleanWall with the leaf count", () => {
      const found = report("export const ok = a && b && c && d;");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("booleanWall");
      expect(found[0].data.leaves).toBe(4);
      expect(found[0].message).toBe(
        "This condition has 4 leaf tests; the maximum is 3." +
          " Assign a group of them to a named const and test the name.",
      );
    });
  });

  describe("when it has three or fewer leaves", () => {
    /** @scenario "A condition within the leaf limit is left alone" */
    it("reports nothing", () => {
      expect(report("export const ok = a && b && c;")).toEqual([]);
    });
  });
});
