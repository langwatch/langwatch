/**
 * @vitest-environment node
 *
 * The name a run plan takes when the caller sends none.
 *
 * The server derives it and the run dialog suggests it, from two copies of
 * one rule. The last block below is what keeps the copies one rule: a run
 * started from the command line and one started from the dialog over the same
 * scope and targets must resolve to the same plan, and they only do while
 * both spell the name the same way.
 *
 * @see specs/suites/run-plan-identity-by-name.feature
 */
import { describe, expect, it } from "vitest";
import { deriveRunName } from "~/components/agent-testing/run/run-configuration";
import { derivePlanName, MAX_PLAN_NAME_LENGTH } from "../plan-name";

describe("derivePlanName", () => {
  describe("when the run names no target", () => {
    it("is named after its scope alone", () => {
      expect(derivePlanName({ scopeLabel: "Refunds", targetLabels: [] })).toBe(
        "Refunds",
      );
    });
  });

  describe("when the run names one target", () => {
    it("reads scope then target", () => {
      expect(
        derivePlanName({
          scopeLabel: "Refunds",
          targetLabels: ["prod-agent"],
        }),
      ).toBe("Refunds prod-agent");
    });
  });

  describe("when the run names several targets", () => {
    it("joins them with vs", () => {
      expect(
        derivePlanName({
          scopeLabel: "2 test suites",
          targetLabels: ["dev-agent", "prod-agent"],
        }),
      ).toBe("2 test suites dev-agent vs prod-agent");
    });
  });

  describe("when a target has no name yet", () => {
    it("leaves the empty label out", () => {
      expect(
        derivePlanName({
          scopeLabel: "Refunds",
          targetLabels: ["", "prod-agent"],
        }),
      ).toBe("Refunds prod-agent");
    });
  });

  describe("when the name would be longer than the API accepts", () => {
    it("cuts it to the maximum", () => {
      const derived = derivePlanName({
        scopeLabel: "Refunds",
        targetLabels: Array.from(
          { length: 40 },
          (_, index) => `agent-with-a-long-name-${index}`,
        ),
      });

      expect(derived).toHaveLength(MAX_PLAN_NAME_LENGTH);
    });
  });

  describe("when the run dialog names the same run", () => {
    it("spells it the same way", () => {
      const cases = [
        { scopeLabel: "Refunds", targetLabels: [] },
        { scopeLabel: "Refunds", targetLabels: ["prod-agent"] },
        {
          scopeLabel: "All scenarios",
          targetLabels: ["dev-agent", "prod-agent"],
        },
        { scopeLabel: "3 test suites", targetLabels: ["prod-agent"] },
        { scopeLabel: "2 scenarios", targetLabels: ["", "prod-agent"] },
      ];

      for (const runCase of cases) {
        expect(derivePlanName(runCase)).toBe(deriveRunName(runCase));
      }
    });
  });
});
