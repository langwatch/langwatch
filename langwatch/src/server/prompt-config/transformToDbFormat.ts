/**
 * Transform camelCase parameter keys to snake_case for database storage.
 */

/**
 * Mapping from camelCase to snake_case for LLM and prompt parameters.
 * Defined locally to avoid server code importing from components.
 */
const CAMEL_TO_SNAKE_MAPPING: Record<string, string> = {
  // LLM parameters
  maxTokens: "max_tokens",
  topP: "top_p",
  frequencyPenalty: "frequency_penalty",
  presencePenalty: "presence_penalty",
  topK: "top_k",
  minP: "min_p",
  repetitionPenalty: "repetition_penalty",
  reasoningEffort: "reasoning_effort",
  // Prompt-specific parameters
  promptingTechnique: "prompting_technique",
  responseFormat: "response_format",
};

/**
 * Build the complete camelCase to snake_case mapping.
 */
export function buildCamelToSnakeMapping(): Record<string, string> {
  return { ...CAMEL_TO_SNAKE_MAPPING };
}

/**
 * Transform an object's camelCase keys to snake_case.
 *
 * @param data - Object with potentially camelCase keys
 * @returns Object with snake_case keys
 */
export function transformCamelToSnake(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  const mapping = buildCamelToSnakeMapping();

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    if (camelKey in result && result[camelKey] !== undefined) {
      result[snakeKey] = result[camelKey];
      delete result[camelKey];
    }
  }

  return result;
}
