import { afterAll, describe, expect, it } from "vitest";
import { conditionShapeRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { agent: { layoutVersion: 0, roles: { contract: {}, server: {}, web: {} } } },
});

afterAll(() => workspace.cleanup());

const SERVICE = "packages/features/agent/server/src/services/agent.service.ts";

function report(code, options = []) {
  return runRule(conditionShapeRule, { code, cwd: workspace.cwd, filename: SERVICE, options });
}

describe("given a strict feature service module", () => {
  describe("when a condition chains more property hops than the limit", () => {
    /** @scenario "An unreadable condition is reported with its measured shape" */
    it("reports nameCondition with the shape it measured and the fix", () => {
      const found = report(
        "export function deep(input) { if (input.meta.owner.name) { return 1; } return 0; }",
      );

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("nameCondition");
      expect(found[0].data).toEqual({ calls: 0, hops: 3, operators: 0 });
      expect(found[0].message).toBe(
        "This condition takes 3 property hops, 0 calls and 0 logical operators to read." +
          " Name it: assign it to a const and test the name.",
      );
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
      expect(
        report(
          "export function deep(input) { if (input.meta.owner.name) { return 1; } return 0; }",
          [{ maxHops: 3 }],
        ),
      ).toEqual([]);
    });
  });

  describe("when a condition trips one of the other three measurements", () => {
    it("reports an optional chain deeper than the limit", () => {
      const found = report(
        "export function optional(input) { if (input?.meta?.owner?.name) { return 1; } return 0; }",
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
        "export function pick(input) { switch (input.meta.owner.name) { default: return 0; } }",
      );

      expect(found.map((entry) => entry.messageId)).toEqual(["nameCondition"]);
    });
  });

  describe("when the fixture workspace, not the repository, is the linter's root", () => {
    it("classifies a file the real repository has never contained", () => {
      const found = runRule(conditionShapeRule, {
        code: "export function deep(input) { if (input.meta.owner.name) { return 1; } return 0; }",
        cwd: workspace.cwd,
        filename: "packages/features/agent/server/src/services/invented.service.ts",
        options: [],
      });

      expect(found).toHaveLength(1);
    });
  });
});
