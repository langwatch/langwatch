import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import { evaluatorFallbackModel } from "../index.ts";

describe("evaluatorFallbackModel", () => {
  /** @scenario "A judge created through the API with no model provider starts on Instant Evals when released" */
  it("starts a judge on Instant Evals when released and no provider is usable", () => {
    expect(
      evaluatorFallbackModel({
        evaluatorType: "langevals/llm_boolean",
        released: true,
        hasUsableProvider: false,
        platformDefault: null,
      }),
    ).toBe(INSTANT_EVAL_JUDGE_MODEL_ID);
  });

  /** @scenario "An evaluator created through the API with no default model is refused otherwise" */
  it.each([
    {
      case: "not released",
      evaluatorType: "langevals/llm_score",
      released: false,
      hasUsableProvider: false,
    },
    {
      case: "a usable provider",
      evaluatorType: "langevals/llm_category",
      released: true,
      hasUsableProvider: true,
    },
    {
      case: "not a judge",
      evaluatorType: "ragas/faithfulness",
      released: true,
      hasUsableProvider: false,
    },
  ])("keeps the platform default with $case", ({ evaluatorType, released, hasUsableProvider }) => {
    expect(
      evaluatorFallbackModel({
        evaluatorType,
        released,
        hasUsableProvider,
        platformDefault: "openai/gpt-5",
      }),
    ).toBe("openai/gpt-5");
    expect(
      evaluatorFallbackModel({ evaluatorType, released, hasUsableProvider, platformDefault: null }),
    ).toBeNull();
  });

  it("keeps the platform default when no type is chosen yet", () => {
    expect(
      evaluatorFallbackModel({
        evaluatorType: undefined,
        released: true,
        hasUsableProvider: false,
        platformDefault: "openai/gpt-5",
      }),
    ).toBe("openai/gpt-5");
  });
});
