import { describe, expect, it } from "vitest";
import { buildLLMConfig } from "../llmConfigBuilder";

describe("buildLLMConfig", () => {
  it("converts camelCase to snake_case", () => {
    const result = buildLLMConfig({
      model: "openai/gpt-4o",
      temperature: 0.7,
      maxTokens: 4096,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
      seed: 42,
      topK: 50,
      minP: 0.1,
      repetitionPenalty: 1.2,
    });

    expect(result).toEqual({
      model: "openai/gpt-4o",
      temperature: 0.7,
      max_tokens: 4096,
      top_p: 0.9,
      frequency_penalty: 0.5,
      presence_penalty: 0.3,
      seed: 42,
      top_k: 50,
      min_p: 0.1,
      repetition_penalty: 1.2,
    });
  });

  it("maps reasoning to reasoning_effort", () => {
    const result = buildLLMConfig({
      model: "openai/gpt-5",
      reasoning: "high",
    });

    expect(result.reasoning_effort).toBe("high");
    expect(result.model).toBe("openai/gpt-5");
  });

  it("includes litellm_params when provided", () => {
    const result = buildLLMConfig({
      model: "openai/gpt-4o",
      litellmParams: { custom_param: "value" },
    });

    expect(result.litellm_params).toEqual({ custom_param: "value" });
  });

  it("includes verbosity when provided", () => {
    const result = buildLLMConfig({
      model: "openai/gpt-4o",
      verbosity: "verbose",
    });

    expect(result.verbosity).toBe("verbose");
  });

  it("handles minimal input with just model", () => {
    const result = buildLLMConfig({
      model: "openai/gpt-4o",
    });

    expect(result.model).toBe("openai/gpt-4o");
    expect(result.temperature).toBeUndefined();
    expect(result.max_tokens).toBeUndefined();
    expect(result.reasoning_effort).toBeUndefined();
  });
});
