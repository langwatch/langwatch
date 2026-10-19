import { findModelById } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { pickMaxTokensCeiling } from "../rules/max-tokens-ceiling.rules.ts";

describe("pickMaxTokensCeiling", () => {
  it("prefers a configured custom-model ceiling", () => {
    expect(
      pickMaxTokensCeiling("custom/model", {
        customModels: [
          {
            modelId: "model",
            displayName: "Model",
            mode: "chat",
            maxTokens: 2048,
          },
        ],
      }),
    ).toBe(2048);
  });

  it("falls back to the catalog completion limit", () => {
    const model = findModelById("openai/gpt-5")[0];
    expect(model).toBeDefined();
    expect(pickMaxTokensCeiling("openai/gpt-5", null)).toBe(
      model?.maxCompletionTokens ?? undefined,
    );
  });

  /** @scenario "An evaluator's max tokens is held to the model's output limit on Vertex AI too" */
  it("reads a Vertex AI model's limit from its Gemini or Claude catalogue entry", () => {
    const gemini = findModelById("gemini/gemini-2.5-pro")[0]?.maxCompletionTokens;
    const claude = findModelById("anthropic/claude-sonnet-4-5")[0]?.maxCompletionTokens;
    expect(gemini).toBe(65536);
    expect(claude).toBeDefined();

    expect(pickMaxTokensCeiling("vertex_ai/gemini-2.5-pro", null)).toBe(gemini);
    expect(pickMaxTokensCeiling("vertex_ai/claude-sonnet-4-5", null)).toBe(claude);
    expect(pickMaxTokensCeiling("vertex_ai/my-tuned-endpoint", null)).toBeUndefined();
  });

  it("returns undefined for an unknown model", () => {
    expect(pickMaxTokensCeiling("unknown/model", undefined)).toBeUndefined();
  });
});
