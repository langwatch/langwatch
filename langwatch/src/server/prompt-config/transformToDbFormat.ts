/**
 * Transform camelCase parameter keys to snake_case for database storage.
 *
 * The 'reasoning' field is the canonical/unified field and is stored as-is.
 * Provider-specific mapping (to reasoning_effort, thinkingLevel, effort)
 * happens at the boundary layer when calling LLM APIs, not here.
 */

/**
 * Mapping from camelCase to snake_case for LLM and prompt parameters.
 * Defined locally to avoid server code importing from components.
 *
 * Note: 'reasoning' is NOT mapped - it stays as 'reasoning' in the database.
 * Provider-specific parameters are mapped at runtime via reasoningBoundary.ts.
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
  // Prompt-specific parameters
  promptingTechnique: "prompting_technique",
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
 * The 'reasoning' field passes through unchanged as the canonical field.
 * Provider-specific mapping happens at the boundary layer (reasoningBoundary.ts)
 * when making actual LLM API calls.
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

  // 'reasoning' passes through unchanged - it's the canonical field
  // Provider-specific mapping happens at runtime boundary (reasoningBoundary.ts)

  // response_format is derived from outputs at read time, never stored directly
  delete result.responseFormat;
  delete result.response_format;

  return result;
}

/**
 * Transform an object's snake_case keys to camelCase.
 * Inverse of transformCamelToSnake, used when data arrives in snake_case
 * (e.g. from the SDK/API) but needs to be passed to methods expecting camelCase.
 *
 * @param data - Object with potentially snake_case keys
 * @returns Object with camelCase keys
 */
export function transformSnakeToCamel(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...data };
  const mapping = buildCamelToSnakeMapping();

  for (const [camelKey, snakeKey] of Object.entries(mapping)) {
    if (snakeKey in result && result[snakeKey] !== undefined) {
      result[camelKey] = result[snakeKey];
      delete result[snakeKey];
    }
  }

  // response_format is derived from outputs at read time, never stored directly
  delete result.responseFormat;
  delete result.response_format;

  return result;
}
