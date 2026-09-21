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
    it("reports nameCondition with the shape it measured and the fix", () => {
      const found = report(DEEP_AND_COMBINING);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("nameCondition");
      expect(found[0].data).toEqual({ calls: 0, hops: 3, operators: 1 });
      expect(found[0].message).toBe(
        "This test combines 0 calls and 1 logical operators across a chain 3 properties deep." +
          " Split it into guard clauses: return, `continue`, or `break` as soon as one part fails," +
          " so each remaining test keeps at most one call and no combined operator — a chain" +
          " alone, however deep, is fine once it stops combining with anything else. For a" +
          " `switch`, read the value once above it and switch on that read. Move a ternary out of" +
          " the test entirely: decide it in the branch it already belongs to, not nested inside" +
          " this one.",
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

      expect(found.map((entry) => entry.messageId)).toEqual(["nameCondition"]);
    });

    it("reports more calls than the limit", () => {
      const found = report(
        "export function calls(a, b) { if (first(a) && second(b)) { return 1; } return 0; }",
      );

      expect(found[0]?.data).toEqual({ calls: 2, hops: 0, operators: 1 });
    });

    it("reports more logical operators than the limit", () => {
      const found = report(
        "export function operators(a, b, c, d) { if (a && b || c && d) { return 1; } return 0; }",
      );

      expect(found[0]?.data.operators).toBe(3);
    });

    it("reports a ternary nested inside the test", () => {
      const found = report(
        "export function nested(a, b) { if (a ? b : !b) { return 1; } return 0; }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nameCondition"]);
    });

    it("reports the discriminant of a switch statement", () => {
      const found = report(
        "export function pick(input) { switch (input.meta.owner.name ?? fallback) { default: return 0; } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nameCondition"]);
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
