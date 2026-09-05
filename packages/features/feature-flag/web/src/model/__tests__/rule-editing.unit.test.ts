import { featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";
import { editorToRules, rulesToEditor } from "../rule-editing";

describe("operator feature-flag rule conversion", () => {
  it("round-trips percentages, tenant conditions, and unknown future conditions", () => {
    const rules = featureFlagRulesSchema.parse([
      {
        match: { organizationId: "organization_1", percentage: 25 },
        enabled: true,
      },
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

    expect(editorToRules(rulesToEditor(rules))).toEqual(rules);
  });

  describe("given a stored rule that names both an organization and a creation date", () => {
    describe("when the operator saves the dialog without touching that rule", () => {
      /** @scenario "a condition the dialog has no field for survives an edit" */
      it("keeps both conditions, because dropping one would widen the rollout to that organization's whole history", () => {
        const rules = featureFlagRulesSchema.parse([
          {
            match: {
              organizationId: "organization_a",
              organizationCreatedAfter: "2026-06-01",
            },
            enabled: true,
          },
        ]);

        expect(editorToRules(rulesToEditor(rules))).toEqual(rules);
      });
    });
  });
});
