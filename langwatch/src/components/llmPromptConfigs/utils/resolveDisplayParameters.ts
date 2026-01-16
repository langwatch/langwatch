import type { ReasoningConfig } from "../../../server/modelProviders/llmModels.types";

/**
 * Resolves generic parameter names to model-specific API parameter names.
 *
 * This function substitutes the generic "reasoning" parameter (used in
 * supportedParameters) with the model-specific API parameter name from
 * reasoningConfig (e.g., "reasoning_effort" for OpenAI, "thinkingLevel" for Gemini).
 *
 * @param supportedParameters - Array of parameter names from model metadata
 * @param reasoningConfig - Model's reasoning configuration (optional)
 * @returns Array with "reasoning" substituted by the actual API parameter name
 */
export function resolveDisplayParameters(
  supportedParameters: string[],
  reasoningConfig?: ReasoningConfig
): string[] {
  if (!reasoningConfig?.parameterName) return supportedParameters;

  return supportedParameters.map((param) =>
    param === "reasoning" ? reasoningConfig.parameterName : param
  );
}
