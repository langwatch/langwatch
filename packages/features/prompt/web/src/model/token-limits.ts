import type { ModelMetadataForFrontend } from "@langwatch/model-provider-contract";

/**
 * Max-token limits shared by the prompt form schema, the parameter registry
 * defaults and the max-token normalisation helpers.
 */

/** Smallest max-tokens value a saved prompt version may carry. */
export const MIN_MAX_TOKENS = 256;

/**
 * Value used when a model reports no completion limit of its own. Kept
 * deliberately conservative so a prompt saved against an unknown model still
 * runs everywhere.
 */
export const FALLBACK_MAX_TOKENS = 4096;

/**
 * The ceiling a model will accept for one completion.
 *
 * Lives in the package-global model rather than beside the LLM-parameter
 * surface because `behavior` reads it too — the draft-prompt hook clamps a new
 * prompt's max-tokens the moment a default model resolves — and a global layer
 * may not reach a public surface. The surface re-exports it, so every existing
 * caller keeps the import it had.
 */
export function getMaxTokenLimit(modelMetadata: ModelMetadataForFrontend | undefined): number {
  return modelMetadata?.maxCompletionTokens ?? modelMetadata?.contextLength ?? FALLBACK_MAX_TOKENS;
}
