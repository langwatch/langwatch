import { afterAll, describe, expect, it } from "vitest";
import { conditionalTypeDepthRule } from "../../src/index.mjs";
import { createFixtureWorkspace, runRule } from "../../src/testing.mjs";

const workspace = createFixtureWorkspace({
  features: { project: { layoutVersion: 0, roles: { contract: {} } } },
});

afterAll(() => workspace.cleanup());

const CONTRACT = "packages/features/project/contract/src/example.contract.ts";
const ALLOWED =
  "State the shape rather than deriving it. A type this deep is usually re-computing something" +
  " a plain interface, a discriminated union, or a `satisfies` clause already says.";

function report(code, filename = CONTRACT) {
  return runRule(conditionalTypeDepthRule, { code, cwd: workspace.cwd, filename });
}

describe("given a type alias in a feature contract", () => {
  describe("when it nests more conditional types than the maximum", () => {
    /** @scenario "A conditional type nested past the maximum is reported with its depth" */
    it("reports stateTheShape naming the type, its depth and the maximum", () => {
      const found = report(`export type Resolve<T> = T extends A
  ? 1
  : T extends B
    ? 2
    : T extends C
      ? 3
      : T extends D
        ? 4
        : 5;`);

      expect(found).toHaveLength(1);
      expect(found[0].messageId).toBe("stateTheShape");
      expect(found[0].message).toBe(
        `Type Resolve nests 4 conditional types; the maximum is 3. ${ALLOWED}`,
      );
    });

    it("counts through the parentheses a writer added for readability", () => {
      const found = report(
        "export type Par<T> = T extends A ? (T extends B ? (T extends C ? (T extends D ? 1 : 2) : 3) : 4) : 5;",
      );

      expect(found[0]?.message).toContain("nests 4 conditional types");
    });
  });

  describe("when it stays inside the maximum", () => {
    /** @scenario "A conditional type inside the maximum is left alone" */
    it("reports nothing", () => {
      expect(report("export type Resolve<T> = T extends A ? 1 : T extends B ? 2 : 3;")).toEqual([]);
    });
  });

  describe("when the depth is spent on the checked and extended types", () => {
    it("reports nothing, because only the branches nest", () => {
      expect(
        report(
          "export type Resolve<T> = (T extends A ? 1 : 2) extends (T extends B ? 1 : 2) ? 3 : 4;",
        ),
      ).toEqual([]);
    });
  });
});
