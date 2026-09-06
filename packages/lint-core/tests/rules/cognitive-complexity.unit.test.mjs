import { afterAll, describe, expect, it } from "vitest";
import { cognitiveComplexityRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code, options = []) {
  return runRule(cognitiveComplexityRule, { code, cwd: workspace.cwd, filename: "x.ts", options });
}

function ifChain(depth) {
  let body = "return 0;";
  for (let index = 0; index < depth; index += 1) {
    body = `if (a${index}) { ${body} } else { ${body} }`;
  }
  return `export function deep(${Array.from({ length: depth }, (_, i) => `a${i}`).join(", ")}) { ${body} }`;
}

describe("given a function", () => {
  describe("when its cognitive complexity passes the default maximum", () => {
    /** @scenario "A function past the complexity maximum is reported with its name and score" */
    it("reports tooComplex naming the function", () => {
      const found = report(ifChain(6));

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("tooComplex");
      expect(found[0].data.name).toBe("deep");
    });
  });

  describe("when it sits at or under the maximum", () => {
    /** @scenario "A simple function is left alone" */
    it("reports nothing", () => {
      expect(report("export function simple(a) { if (a) { return 1; } return 0; }")).toEqual([]);
    });
  });

  describe("when the caller lowers the max option", () => {
    /** @scenario "The max option lowers the threshold the rule measures against" */
    it("reports a function that would otherwise pass", () => {
      const found = report("export function simple(a) { if (a) { return 1; } return 0; }", [
        { max: 0 },
      ]);

      expect(found).toHaveLength(1);
      expect(found[0].data.max).toBe(0);
    });
  });
});
