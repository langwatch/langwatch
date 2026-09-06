import { afterAll, describe, expect, it } from "vitest";
import { runtimeUndefinedRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({});

afterAll(() => workspace.cleanup());

function report(code) {
  return runRule(runtimeUndefinedRule, { code, cwd: workspace.cwd, filename: "x.ts" });
}

describe("given any source file", () => {
  describe("when a value position reads the ambient undefined", () => {
    /** @scenario "The ambient undefined value is reported and fixed to void 0" */
    it("reports runtimeUndefined", () => {
      const found = report("export const x = undefined;");

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("runtimeUndefined");
    });
  });

  describe("when undefined is shadowed by a parameter", () => {
    /** @scenario "A shadowed undefined binding is left alone" */
    it("reports nothing", () => {
      expect(report("export function f(undefined) { return undefined; }")).toEqual([]);
    });
  });

  describe("when undefined names an import", () => {
    /** @scenario "undefined used as an identifier position is left alone" */
    it("reports nothing for a property key", () => {
      expect(report("export const o = { undefined: 1 };")).toEqual([]);
    });
  });
});
