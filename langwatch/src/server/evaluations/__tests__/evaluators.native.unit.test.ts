import { describe, expect, it } from "vitest";
import { AVAILABLE_EVALUATORS, evaluatorsSchema } from "../evaluators";
import {
  API_KEYS_AND_SECRETS_DETECTION,
  isNativeEvaluatorType,
} from "../evaluators.native";

describe("native evaluator merge into the facade", () => {
  it("exposes the native secrets evaluator in AVAILABLE_EVALUATORS", () => {
    const def = AVAILABLE_EVALUATORS[API_KEYS_AND_SECRETS_DETECTION];
    expect(def).toBeDefined();
    expect(def.category).toBe("safety");
    expect(def.isGuardrail).toBe(true);
  });

  it("keeps the generated langevals evaluators alongside it", () => {
    expect(AVAILABLE_EVALUATORS["presidio/pii_detection"]).toBeDefined();
    expect(AVAILABLE_EVALUATORS["langevals/exact_match"]).toBeDefined();
  });

  it("merges the native settings schema so the form and validation see it", () => {
    expect(API_KEYS_AND_SECRETS_DETECTION in evaluatorsSchema.shape).toBe(true);
    // A native settings payload (empty) parses.
    expect(
      evaluatorsSchema.shape[API_KEYS_AND_SECRETS_DETECTION].safeParse({
        settings: {},
      }).success,
    ).toBe(true);
  });

  it("identifies native vs langevals evaluator types", () => {
    expect(isNativeEvaluatorType(API_KEYS_AND_SECRETS_DETECTION)).toBe(true);
    expect(isNativeEvaluatorType("presidio/pii_detection")).toBe(false);
  });
});
