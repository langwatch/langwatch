import { afterAll, describe, expect, it } from "vitest";

import { conditionShapeRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, process: {}, browser: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "modules/agent/process/src/services/agent.service.ts";

/** A deep chain that also combines, which is what the rule reports. */
const DEEP_AND_COMBINING =
  "export function deep(input) { if (input.meta.owner.name && input.active) { return 1; } return 0; }";

function report(code, options = []) {
  return runRule(conditionShapeRule, { code, cwd: workspace.cwd, filename: SERVICE, options });
}

describe("given a strict feature service module", () => {
  describe("when a condition chains more property hops than the limit and also combines", () => {
    /** @scenario "An unreadable condition is reported with its measured shape" */
    it("reports chainTooDeep naming the limit, its value and the fix", () => {
      const found = report(DEEP_AND_COMBINING);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("chainTooDeep");
      expect(found[0].data).toEqual({ hops: 3, maxHops: 2 });
      expect(found[0].message).toBe(
        "This test reads a chain 3 properties deep and also calls or combines; `maxHops` is 2." +
          " Read the chain into a named `const` above the test; a chain alone, however deep, is" +
          " fine once it stops combining with anything else.",
      );
    });
  });

  describe("when a condition exceeds several limits at once", () => {
    /** @scenario "Each exceeded limit is its own report" */
    it("reports one message per exceeded limit, each naming its limit", () => {
      const found = report(
        "export function all(a, b) {\n  if (a.b.c.d() && first(b) || (a ? b : !b) && (x ?? y)) { return 1; }\n  return 0;\n}",
      );

      expect(found.map((entry) => [entry.messageId, entry.line])).toEqual([
        ["tooManyCalls", 2],
        ["tooManyOperators", 2],
        ["chainTooDeep", 2],
        ["ternaryInTest", 2],
      ]);
      expect(found[0].message).toMatch(/^This test makes 2 calls; `maxCalls` is 1\./);
      expect(found[1].message).toMatch(
        /^This test joins 4 logical operators; `maxOperators` is 2\./,
      );
    });
  });

  describe("when a deep chain neither calls nor combines", () => {
    /** @scenario "A property chain on its own is never reported" */
    it("reports nothing, because naming it would only restate it", () => {
      expect(
        report(
          "export function has(input) { if (input.plan.bindingIds.length > 0) { return 1; } return 0; }",
        ),
      ).toEqual([]);
    });

    it("reports nothing however deep the chain runs", () => {
      expect(
        report("export function deep(input) { if (input.a.b.c.d.e.f) { return 1; } return 0; }"),
      ).toEqual([]);
    });
  });

  describe("when a condition sits inside every limit", () => {
    /** @scenario "A condition within every limit is left alone" */
    it("reports nothing", () => {
      expect(
        report("export function guard(input) { if (!input.id) { return null; } return input; }"),
      ).toEqual([]);
    });
  });

  describe("when the caller raises maxHops", () => {
    /** @scenario "The option keys raise the limits the rule measures against" */
    it("reports nothing at the raised limit", () => {
      expect(report(DEEP_AND_COMBINING, [{ maxHops: 3 }])).toEqual([]);
    });
  });

  describe("when a condition trips one of the other three measurements", () => {
    it("reports an optional chain deeper than the limit", () => {
      const found = report(
        "export function optional(input) { if (input?.meta?.owner?.name && input.active) { return 1; } return 0; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["chainTooDeep"]);
    });

    it("reports more calls than the limit", () => {
      const found = report(
        "export function calls(a, b) { if (first(a) && second(b)) { return 1; } return 0; }",
      );

      expect(found.map((entry) => [entry.messageId, entry.data])).toEqual([
        ["tooManyCalls", { calls: 2, maxCalls: 1 }],
      ]);
    });

    it("reports more logical operators than the limit", () => {
      const found = report(
        "export function operators(a, b, c, d) { if (a && b || c && d) { return 1; } return 0; }",
      );

      expect(found.map((entry) => [entry.messageId, entry.data])).toEqual([
        ["tooManyOperators", { maxOperators: 2, operators: 3 }],
      ]);
    });

    it("reports a ternary nested inside the test", () => {
      const found = report(
        "export function nested(a, b) { if (a ? b : !b) { return 1; } return 0; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["ternaryInTest"]);
    });

    it("reports the discriminant of a switch statement", () => {
      const found = report(
        "export function pick(input) { switch (input.meta.owner.name ?? fallback) { default: return 0; } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["chainTooDeep"]);
    });
  });

  describe("when the fixture workspace, not the repository, is the linter's root", () => {
    it("classifies a file the real repository has never contained", () => {
      const found = runRule(conditionShapeRule, {
        code: DEEP_AND_COMBINING,
        cwd: workspace.cwd,
        filename: "modules/agent/process/src/services/invented.service.ts",
        options: [],
      });

      expect(found).toHaveLength(1);
    });
  });
});
