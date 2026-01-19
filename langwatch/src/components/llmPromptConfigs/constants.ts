/**
 * LLM Config Constants
 *
 * Centralized constants for LLM configuration components.
 */

/**
 * When a model has dynamic max tokens (e.g., max_tokens), we use this proportion
 * of the model's max as a sensible default starting point.
 *
 * Rationale: 25% provides a reasonable balance - enough tokens for most
 * responses while leaving headroom for longer generations.
 *
 * @see specs/model-config/model-parameter-display.feature line 92
 */
export const DYNAMIC_MAX_DEFAULT_PROPORTION = 0.25;

/**
 * Standard icon sizes for model provider icons.
 * Used consistently across ModelSelector, LLMModelDisplay, and related components.
 */
export const MODEL_ICON_SIZE = "16px";
export const MODEL_ICON_SIZE_SM = "14px";
