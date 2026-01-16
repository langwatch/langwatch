import { describe, it, expect } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import { normalizeToSnakeCase } from "../normalizeToSnakeCase";
import type { LLMConfig } from "../../../../types/dsl";

const BASE_CONFIG = { model: DEFAULT_MODEL };
const CAMEL_CASE_PARAMS = {
  maxTokens: 1000,
  topP: 0.9,
  frequencyPenalty: 0.5,
  presencePenalty: 0.3,
};
const SNAKE_CASE_PARAMS = {
  max_tokens: 1000,
  top_p: 0.9,
  frequency_penalty: 0.5,
  presence_penalty: 0.3,
};

describe("normalizeToSnakeCase", () => {
  it("converts camelCase keys to snake_case", () => {
    const input = {
      ...BASE_CONFIG,
      ...CAMEL_CASE_PARAMS,
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result).toEqual({
      ...BASE_CONFIG,
      ...SNAKE_CASE_PARAMS,
    });
  });

  it("preserves unknown keys unchanged", () => {
    const input = {
      ...BASE_CONFIG,
      customParameter: "value",
      anotherUnknown: 123,
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result).toEqual({
      ...BASE_CONFIG,
      customParameter: "value",
      anotherUnknown: 123,
    });
  });

  it("handles undefined values correctly by skipping them", () => {
    const input = {
      ...BASE_CONFIG,
      maxTokens: undefined,
      topP: 0.9,
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result).toEqual({
      ...BASE_CONFIG,
      maxTokens: undefined,
      top_p: 0.9,
    });
  });

  it("gives camelCase precedence when both camelCase and snake_case exist", () => {
    const input = {
      ...BASE_CONFIG,
      maxTokens: 2000,
      max_tokens: 1000,
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result.max_tokens).toBe(2000);
    expect(result).not.toHaveProperty("maxTokens");
  });

  it("does not modify the original object", () => {
    const input = {
      ...BASE_CONFIG,
      maxTokens: 1000,
    } as LLMConfig & Record<string, unknown>;

    const originalInput = { ...input };
    normalizeToSnakeCase(input);

    expect(input).toEqual(originalInput);
  });

  it("converts all mapped parameters correctly", () => {
    const input = {
      ...BASE_CONFIG,
      ...CAMEL_CASE_PARAMS,
      topK: 40,
      minP: 0.1,
      repetitionPenalty: 1.1,
      reasoningEffort: "high",
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result).toEqual({
      ...BASE_CONFIG,
      ...SNAKE_CASE_PARAMS,
      top_k: 40,
      min_p: 0.1,
      repetition_penalty: 1.1,
      reasoning_effort: "high",
    });
  });

  it("preserves parameters that are same in both conventions", () => {
    const input = {
      ...BASE_CONFIG,
      temperature: 0.7,
      seed: 42,
      verbosity: "medium",
    } as LLMConfig & Record<string, unknown>;

    const result = normalizeToSnakeCase(input);

    expect(result).toEqual({
      ...BASE_CONFIG,
      temperature: 0.7,
      seed: 42,
      verbosity: "medium",
    });
  });
});
