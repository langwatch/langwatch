import { featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";

import {
  insertionIndexForNewRule,
  newRule,
  rulesToUI,
  uiToRules,
  withRuleAdded,
  withRuleMoved,
  type UIRule,
} from "../rule-editing.ts";

/** A rule as the dialog holds it, named by scope so the order reads. */
function uiRule(id: string, patch: Partial<UIRule> = {}): UIRule {
  return {
    id,
    scopeKind: "ORGANIZATION",
    target: `organization_${id}`,
    enabled: true,
    otherConditions: {},
    ...patch,
  };
}

describe("operator feature-flag rule conversion", () => {
  it("round-trips percentages, tenant conditions, and unknown future conditions", () => {
    const rules = featureFlagRulesSchema.parse([
      { match: { organizationId: "organization_1", percentage: 25 }, enabled: true },
      {
        match: {
          projectId: "project_1",
          organizationId: "organization_1",
          percentage: 60,
          futureCondition: "preserved",
        },
        enabled: false,
      },
    ]);

    expect(uiToRules(rulesToUI(rules))).toEqual(rules);
  });

  describe("given a stored rule that names both an organization and a creation date", () => {
    describe("when the operator saves the dialog without touching that rule", () => {
      /** @scenario "a condition the dialog has no field for survives an edit" */
      it("keeps both conditions, because dropping one would widen the rollout to that organization's whole history", () => {
        const rules = featureFlagRulesSchema.parse([
          {
            match: { organizationId: "organization_a", organizationCreatedAfter: "2026-06-01" },
            enabled: true,
          },
        ]);

        expect(uiToRules(rulesToUI(rules))).toEqual(rules);
      });
    });
  });
});

describe("where an added rule lands", () => {
  describe("given the rules for a flag end with a rule that applies to everyone", () => {
    describe("when the operator adds a rule", () => {
      /** @scenario "a new rule lands above a trailing everyone rule" */
      it("places it directly above the everyone rule, which would otherwise answer first", () => {
        const rules = [uiRule("a"), uiRule("catch-all", { scopeKind: "EVERYONE", target: "" })];

        const added = newRule();
        const next = withRuleAdded(rules, added);

        expect(insertionIndexForNewRule(rules)).toBe(1);
        expect(next.map((rule) => rule.id)).toEqual(["a", added.id, "catch-all"]);
      });
    });
  });

  describe("given the rules for a flag end with an organization rule", () => {
    describe("when the operator adds a rule", () => {
      /** @scenario "a new rule is appended when the list does not end in everyone" */
      it("places it at the end, which is what lowest priority means", () => {
        const rules = [uiRule("a"), uiRule("b")];

        const added = newRule();
        const next = withRuleAdded(rules, added);

        expect(insertionIndexForNewRule(rules)).toBe(2);
        expect(next.map((rule) => rule.id)).toEqual(["a", "b", added.id]);
      });
    });
  });
});

describe("moving a rule", () => {
  describe("when a rule is moved onto the position another one holds", () => {
    it("puts it there and shifts the rest", () => {
      const rules = [uiRule("a"), uiRule("b"), uiRule("c")];

      expect(withRuleMoved(rules, { fromId: "c", toId: "a" }).map((rule) => rule.id)).toEqual([
        "c",
        "a",
        "b",
      ]);
    });
  });

  describe("when the move names a rule that is not in the list", () => {
    it("leaves the order untouched", () => {
      const rules = [uiRule("a"), uiRule("b")];

      expect(withRuleMoved(rules, { fromId: "a", toId: "missing" })).toBe(rules);
    });
  });
});
