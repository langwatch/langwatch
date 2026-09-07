import type { ModelMetadataForFrontend } from "@langwatch/model-provider-contract";
import { FALLBACK_MAX_TOKENS } from "@langwatch/prompt-contract";

/**
 * The ceiling a model will accept for one completion.
 *
 * Lives in the package-global model rather than beside the LLM-parameter
 * surface because `behavior` reads it too — the draft-prompt hook clamps a new
 * prompt's max-tokens the moment a default model resolves — and a global layer
 * may not reach a public surface.
 */
export function getMaxTokenLimit(modelMetadata: ModelMetadataForFrontend | undefined): number {
  return modelMetadata?.maxCompletionTokens ?? modelMetadata?.contextLength ?? FALLBACK_MAX_TOKENS;
}
