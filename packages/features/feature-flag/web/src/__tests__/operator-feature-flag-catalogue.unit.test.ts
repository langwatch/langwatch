import { featureFlagRulesSchema } from "@langwatch/feature-flag-contract";
import { describe, expect, it } from "vitest";
import { editorToRules, rulesToEditor } from "../operator-feature-flag-catalogue";

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
});
