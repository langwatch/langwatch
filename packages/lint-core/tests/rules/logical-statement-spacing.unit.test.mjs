import { afterAll, describe, expect, it } from "vitest";
import { logicalStatementSpacingRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(logicalStatementSpacingRule, { code, cwd: workspace.cwd, filename: "x.ts" });
}

describe("given a function body", () => {
  describe("when a statement follows an if with no blank line", () => {
    /** @scenario "A statement crowding a control-flow block is reported and fixed" */
    it("reports statementSpacing", () => {
      const found = report(
        "export function f(a) {\n  if (a) {\n    return 1;\n  }\n  return 2;\n}",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("statementSpacing");
    });
  });

  describe("when a blank line already separates them", () => {
    /** @scenario "A blank line after control flow satisfies the rule" */
    it("reports nothing", () => {
      expect(
        report("export function f(a) {\n  if (a) {\n    return 1;\n  }\n\n  return 2;\n}"),
      ).toEqual([]);
    });
  });
});
