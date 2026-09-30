/**
 * The generation parameters an evaluator's settings may carry for its judge
 * model, and the rules that decide which of them reach the evaluator engine.
 *
 * The evaluator model editor writes these into the evaluator settings next to
 * the evaluator's own fields (prompt, model, max_tokens). Each dispatch path
 * runs them through `pickGenerationParams` so the evaluator's generated
 * settings schema, which knows nothing about them, cannot drop them, and
 * `setupModelEnv` turns them into X_LITELLM_* request variables.
 *
 * Spec: specs/evaluators/evaluator-generation-params.feature
 */

export const GENERATION_PARAM_KEYS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "reasoning_effort",
] as const;

export type GenerationParamKey = (typeof GENERATION_PARAM_KEYS)[number];

export type GenerationParams = Partial<Record<GenerationParamKey, unknown>>;

/**
 * The generation parameters present in a settings object, and nothing else.
 * Absent and null values are left out so a missing parameter stays missing.
 */
export function pickGenerationParams(
  settings: Record<string, unknown> | null | undefined,
): GenerationParams {
  const picked: GenerationParams = {};
  if (!settings) return picked;
  for (const key of GENERATION_PARAM_KEYS) {
    const value = settings[key];
    if (value !== undefined && value !== null) {
      picked[key] = value;
    }
  }
  return picked;
}
