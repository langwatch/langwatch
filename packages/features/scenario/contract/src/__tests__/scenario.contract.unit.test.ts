import {
  runParameterValuesSchema,
  scenarioParameterDefinitionsSchema,
  scenarioSchema,
} from "../index";
import { describe, expect, it } from "vitest";

describe("Scenario contract", () => {
  /** @scenario "Secret parameter definitions cannot persist a default" */
  it("refuses defaults on secret parameters", () => {
    const parsed = scenarioParameterDefinitionsSchema.safeParse([
      { name: "api_token", secret: true, defaultValue: "not-a-secret" },
    ]);

    expect(parsed.success).toBe(false);
  });

  it("refuses prototype-sensitive supplied parameter names", () => {
    const parsed = runParameterValuesSchema.safeParse(
      JSON.parse('{"__proto__":"unsafe"}'),
    );

    expect(parsed.success).toBe(false);
  });

  it("keeps model selections and declared parameter JSON in the scenario contract", () => {
    const parsed = scenarioSchema.parse({
      id: "scenario_1",
      projectId: "project_1",
      name: "Refund flow",
      situation: "A {{ params.region }} customer asks for a refund",
      criteria: ["Answers the question"],
      labels: [],
      parameters: [
        {
          name: "region",
          description: "The billing region",
          defaultValue: "eu-central",
        },
      ],
      simulatorModel: "openai/gpt-5-mini",
      judgeModel: "openai/gpt-5-nano",
      maxTurns: 5,
      minTurns: 1,
      folderId: null,
      version: 1,
      lastUpdatedById: null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(1),
    });

    expect(parsed.parameters).toEqual([
      {
        name: "region",
        description: "The billing region",
        defaultValue: "eu-central",
      },
    ]);
    expect(parsed.simulatorModel).toBe("openai/gpt-5-mini");
    expect(parsed.judgeModel).toBe("openai/gpt-5-nano");
  });
});
