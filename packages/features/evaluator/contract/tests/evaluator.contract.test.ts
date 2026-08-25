import { describe, expect, it } from "vitest";
import {
  codeEvaluatorConfigSchema,
  defaultCodeEvaluatorConfig,
  evaluatorDisplayName,
  evaluatorSchema,
  evaluatorTypeSchema,
  getEvaluatorDefaultSettings,
} from "../src";

describe("evaluator contract", () => {
  it("keeps the public evaluator type vocabulary explicit", () => {
    expect(evaluatorTypeSchema.parse("workflow")).toBe("workflow");
    expect(() => evaluatorTypeSchema.parse("unknown")).toThrow();
  });

  it("validates the transport-neutral evaluator value", () => {
    expect(
      evaluatorSchema.parse({
        id: "e1",
        projectId: "p1",
        name: "Quality",
        slug: "quality",
        type: "evaluator",
        config: {},
        workflowId: null,
        copiedFromEvaluatorId: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).projectId,
    ).toBe("p1");
  });

  it("resolves configured models without leaking persistence concerns", () => {
    expect(
      getEvaluatorDefaultSettings(
        {
          name: "x",
          description: "x",
          category: "quality",
          isGuardrail: false,
          requiredFields: [],
          optionalFields: [],
          envVars: [],
          result: {},
          settings: {
            model: { default: "wrong" },
            embeddings_model: { default: "wrong" },
          },
        },
        { defaultModel: "provider/chat", embeddingsModel: "provider/embed" },
      ),
    ).toEqual({
      model: "provider/chat",
      embeddings_model: "provider/embed",
    });
  });

  it("keeps code evaluator defaults and display names in the portable vocabulary", () => {
    expect(codeEvaluatorConfigSchema.parse(defaultCodeEvaluatorConfig)).toEqual(
      defaultCodeEvaluatorConfig,
    );
    expect(evaluatorDisplayName("OpenAI Moderation")).toBe("Moderation");
  });
});
