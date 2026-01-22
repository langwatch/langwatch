import { PARAM_NAME_MAPPING } from "~/components/llmPromptConfigs/parameterConfig";
import type { LLMConfig } from "../../../types/dsl";

/**
 * Reverse mapping: camelCase → snake_case
 * Built from PARAM_NAME_MAPPING which maps snake_case → camelCase
 */
const CAMEL_TO_SNAKE: Record<string, string> = Object.fromEntries(
  Object.entries(PARAM_NAME_MAPPING).map(([snake, camel]) => [camel, snake]),
);

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
