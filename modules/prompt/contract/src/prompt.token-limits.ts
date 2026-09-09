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
