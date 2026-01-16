import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL } from "~/utils/constants";
import {
  buildCamelToSnakeMapping,
  transformCamelToSnake,
} from "../transformToDbFormat";

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

describe("transformToDbFormat", () => {
  describe("buildCamelToSnakeMapping", () => {
    it("includes all expected LLM parameter mappings", () => {
      const mapping = buildCamelToSnakeMapping();

      expect(mapping.maxTokens).toBe("max_tokens");
      expect(mapping.topP).toBe("top_p");
      expect(mapping.frequencyPenalty).toBe("frequency_penalty");
      expect(mapping.presencePenalty).toBe("presence_penalty");
      expect(mapping.topK).toBe("top_k");
      expect(mapping.minP).toBe("min_p");
      expect(mapping.repetitionPenalty).toBe("repetition_penalty");
      expect(mapping.reasoningEffort).toBe("reasoning_effort");
    });

    it("includes prompt-specific mappings", () => {
      const mapping = buildCamelToSnakeMapping();

      expect(mapping.promptingTechnique).toBe("prompting_technique");
      expect(mapping.responseFormat).toBe("response_format");
    });
  });

  describe("transformCamelToSnake", () => {
    it("converts maxTokens to max_tokens when defined", () => {
      const input = { ...BASE_CONFIG, maxTokens: 1000 };
      const result = transformCamelToSnake(input);

      expect(result.max_tokens).toBe(1000);
      expect(result).not.toHaveProperty("maxTokens");
    });

    it("converts promptingTechnique to prompting_technique when defined", () => {
      const input = { ...BASE_CONFIG, promptingTechnique: "chain-of-thought" };
      const result = transformCamelToSnake(input);

      expect(result.prompting_technique).toBe("chain-of-thought");
      expect(result).not.toHaveProperty("promptingTechnique");
    });

    it("converts responseFormat to response_format when defined", () => {
      const input = { ...BASE_CONFIG, responseFormat: { type: "json" } };
      const result = transformCamelToSnake(input);

      expect(result.response_format).toEqual({ type: "json" });
      expect(result).not.toHaveProperty("responseFormat");
    });

    it("skips undefined values", () => {
      const input = { ...BASE_CONFIG, maxTokens: undefined };
      const result = transformCamelToSnake(input);

      expect(result).toHaveProperty("maxTokens", undefined);
      expect(result).not.toHaveProperty("max_tokens");
    });

    it("converts all LLM parameters", () => {
      const input = {
        ...BASE_CONFIG,
        ...CAMEL_CASE_PARAMS,
        topK: 40,
        minP: 0.1,
        repetitionPenalty: 1.1,
        reasoningEffort: "high",
      };

      const result = transformCamelToSnake(input);

      expect(result).toEqual({
        ...BASE_CONFIG,
        ...SNAKE_CASE_PARAMS,
        top_k: 40,
        min_p: 0.1,
        repetition_penalty: 1.1,
        reasoning_effort: "high",
      });
    });

    it("preserves keys that are already snake_case", () => {
      const input = {
        ...BASE_CONFIG,
        temperature: 0.7,
        seed: 42,
      };

      const result = transformCamelToSnake(input);

      expect(result).toEqual({
        ...BASE_CONFIG,
        temperature: 0.7,
        seed: 42,
      });
    });

    it("does not modify the original object", () => {
      const input = { ...BASE_CONFIG, maxTokens: 1000 };
      const originalInput = { ...input };

      transformCamelToSnake(input);

      expect(input).toEqual(originalInput);
    });
  });
});
