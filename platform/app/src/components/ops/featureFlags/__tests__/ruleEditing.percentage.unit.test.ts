/**
 * The percentage-of-users scope in the targeting rules dialog: a stored
 * `percentageRollout` opens as that scope with its number, and saving writes
 * the same number back.
 *
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { describe, expect, it } from "vitest";
import { findUnfillableRule, rulesToUI, uiToRules } from "../ruleEditing";

describe("given a stored rule enabling the flag for a quarter of the users", () => {
  const stored = [{ match: { percentageRollout: 25 }, enabled: true }];

  describe("when the rule is opened in the targeting rules dialog", () => {
    /** @scenario "the ops page reads and writes a percentage rollout rule" */
    it("shows as a percentage rule with 25 and saves the same percentage back", () => {
      const ui = rulesToUI(stored);

      expect(ui).toHaveLength(1);
      expect(ui[0]).toMatchObject({
        scopeKind: "PERCENTAGE",
        target: "25",
        enabled: true,
        otherConditions: {},
      });

      expect(uiToRules(ui)).toEqual(stored);
    });
  });

  describe("when the operator types a number outside the range", () => {
    it("is reported as unfillable rather than saved", () => {
      const [rule] = rulesToUI(stored);
      if (!rule) throw new Error("expected one rule");

      expect(findUnfillableRule([{ ...rule, target: "150" }])).toBeDefined();
      expect(findUnfillableRule([{ ...rule, target: "abc" }])).toBeDefined();
      expect(findUnfillableRule([{ ...rule, target: "" }])).toBeDefined();
      expect(findUnfillableRule([{ ...rule, target: "0" }])).toBeUndefined();
      expect(findUnfillableRule([{ ...rule, target: "100" }])).toBeUndefined();
    });
  });

  describe("when the stored rule also names an organization", () => {
    it("keeps the organization as the scope and carries the percentage along", () => {
      const ui = rulesToUI([
        {
          match: { organizationId: "organization_acme", percentageRollout: 25 },
          enabled: true,
        },
      ]);

      expect(ui[0]).toMatchObject({
        scopeKind: "ORGANIZATION",
        target: "organization_acme",
        otherConditions: { percentageRollout: 25 },
      });
      expect(uiToRules(ui)[0]?.match).toEqual({
        organizationId: "organization_acme",
        percentageRollout: 25,
      });
    });
  });
});
