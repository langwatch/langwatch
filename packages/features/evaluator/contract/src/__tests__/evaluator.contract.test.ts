import { describe, expect, it } from "vitest";
import {
  API_KEYS_AND_SECRETS_DETECTION,
  AVAILABLE_EVALUATORS,
  codeEvaluatorConfigSchema,
  codeEvaluatorIdFromCheckType,
  defaultCodeEvaluatorConfig,
  evaluatorDisplayName,
  evaluatorSchema,
  evaluatorTypeSchema,
  getEvaluatorDefaultSettings,
  getEvaluatorDefinitions,
  isNativeEvaluatorType,
  isCodeEvaluatorCheckType,
} from "../index";

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
    expect(isCodeEvaluatorCheckType("code/evaluator_abc")).toBe(true);
    expect(codeEvaluatorIdFromCheckType("code/evaluator_abc")).toBe("evaluator_abc");
    expect(codeEvaluatorIdFromCheckType("workflow")).toBeUndefined();
  });

  it("merges native and generated evaluators into one catalogue", () => {
    const native = AVAILABLE_EVALUATORS[API_KEYS_AND_SECRETS_DETECTION];

    expect(native.category).toBe("safety");
    expect(native.isGuardrail).toBe(true);
    expect(AVAILABLE_EVALUATORS["presidio/pii_detection"]).toBeDefined();
    expect(AVAILABLE_EVALUATORS["langevals/exact_match"]).toBeDefined();
    expect(isNativeEvaluatorType(API_KEYS_AND_SECRETS_DETECTION)).toBe(true);
    expect(isNativeEvaluatorType("presidio/pii_detection")).toBe(false);
    expect(getEvaluatorDefinitions(API_KEYS_AND_SECRETS_DETECTION)).toBe(native);
  });
});
