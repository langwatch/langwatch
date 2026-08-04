import type { LLMConfig } from "../../../types/dsl";

/**
 * camelCase → snake_case mapping for LLM config parameters.
 * Mirrors PARAM_NAME_MAPPING in parameterConfig.ts (reversed).
 */
const CAMEL_TO_SNAKE: Record<string, string> = {
  topP: "top_p",
  frequencyPenalty: "frequency_penalty",
  presencePenalty: "presence_penalty",
  maxTokens: "max_tokens",
  topK: "top_k",
  minP: "min_p",
  repetitionPenalty: "repetition_penalty",
};

/**
 * Normalizes LLM config to snake_case format required by optimization studio DSL.
 *
 * Converts all camelCase parameter keys to their snake_case equivalents
 * using PARAM_NAME_MAPPING as the single source of truth.
 */
export function normalizeToSnakeCase(
  llmConfig: LLMConfig & Record<string, unknown>,
): LLMConfig {
  const result = { ...llmConfig } as Record<string, unknown>;

  for (const [camelKey, snakeKey] of Object.entries(CAMEL_TO_SNAKE)) {
    if (camelKey in result && result[camelKey] !== undefined) {
      const value = result[camelKey];
      delete result[camelKey];
      // camelCase takes precedence when both exist (for backwards compatibility)
      result[snakeKey] = value;
    }
  }

  return result as LLMConfig;
}
