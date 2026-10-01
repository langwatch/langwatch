import { describe, expect, it } from "vitest";

import {
  runParameterValuesSchema,
  scenarioCreateInputSchema,
  scenarioParameterDefinitionsSchema,
  scenarioSchema,
} from "../index.ts";

/** A full scenario row shape, as `transaction.scenario.create`/`findFirst`
 *  hand back from Postgres — every Prisma model column carries a key, so a
 *  strict schema must recognise every one of them, `callerVoice` included. */
function scenarioRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "scenario_1",
    projectId: "project_1",
    name: "Refund flow",
    situation: "A customer asks for a refund",
    criteria: ["Answers the question"],
    labels: [],
    parameters: null,
    simulatorModel: null,
    judgeModel: null,
    maxTurns: null,
    minTurns: null,
    fields: null,
    callerVoice: null,
    testSuiteId: null,
    version: 1,
    lastUpdatedById: null,
    archivedAt: null,
    createdAt: new Date(0),
    updatedAt: new Date(1),
    ...overrides,
  };
}

describe("Scenario contract", () => {
  /** @scenario "Secret parameter definitions cannot persist a default" */
  it("refuses defaults on secret parameters", () => {
    const parsed = scenarioParameterDefinitionsSchema.safeParse([
      { name: "api_token", secret: true, defaultValue: "not-a-secret" },
    ]);

    expect(parsed.success).toBe(false);
  });

  it("refuses prototype-sensitive supplied parameter names", () => {
    const parsed = runParameterValuesSchema.safeParse(JSON.parse('{"__proto__":"unsafe"}'));

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
      testSuiteId: null,
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

describe("scenarioSchema", () => {
  describe("given a stored scenario row", () => {
    /** @scenario "A scenario row with the caller-voice column parses" */
    it("parses a row carrying a null callerVoice column", () => {
      const parsed = scenarioSchema.parse(scenarioRow());

      expect(parsed.callerVoice).toBeNull();
    });

    /** @scenario "A stored scenario keeps its caller voice through the module contract" */
    it("parses a row carrying a stored caller-voice config", () => {
      const storedConfig = {
        voiceModel: "openai/nova",
        interruptProbability: 0.2,
        effects: "none",
      };

      const parsed = scenarioSchema.parse(scenarioRow({ callerVoice: storedConfig }));

      expect(parsed.callerVoice).toEqual(storedConfig);
    });

    it("crashes on the exact pre-fix row shape without regressing", () => {
      // Regression guard: before the fix, scenarioSchema had no `callerVoice`
      // key, so `.strict()` rejected every row this shape describes with
      // `unrecognized_keys: ["callerVoice"]`. This is the exact shape
      // `transaction.scenario.create`/`findFirst` hand back for a real
      // Prisma row (`Scenario.callerVoice Json?` is present on every row).
      expect(() => scenarioSchema.parse(scenarioRow())).not.toThrow();
    });
  });
});

describe("scenarioCreateInputSchema", () => {
  describe("when the caller voice is a valid config", () => {
    it("accepts it", () => {
      const parsed = scenarioCreateInputSchema.parse({
        projectId: "project_1",
        name: "Refund flow",
        situation: "A customer asks for a refund",
        callerVoice: {
          voiceModel: "openai/nova",
          interruptProbability: 0.5,
          effects: "phone_line",
        },
      });

      expect(parsed.callerVoice).toEqual({
        voiceModel: "openai/nova",
        interruptProbability: 0.5,
        effects: "phone_line",
      });
    });
  });

  describe("when the caller voice is absent", () => {
    it("leaves it unset rather than defaulting to a value", () => {
      const parsed = scenarioCreateInputSchema.parse({
        projectId: "project_1",
        name: "Refund flow",
        situation: "A customer asks for a refund",
      });

      expect(parsed.callerVoice).toBeUndefined();
    });
  });

  describe("when the caller voice is null", () => {
    it("refuses it, since a plain null is not a valid Prisma JSON write", () => {
      const parsed = scenarioCreateInputSchema.safeParse({
        projectId: "project_1",
        name: "Refund flow",
        situation: "A customer asks for a refund",
        callerVoice: null,
      });

      expect(parsed.success).toBe(false);
    });
  });
});
