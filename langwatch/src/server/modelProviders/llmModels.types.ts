/**
 * Types for the LLM Model Registry
 *
 * These types define the structure of llmModels.json which contains
 * model metadata including pricing, parameters, and capabilities.
 */

// ============================================================================
// Pricing Types
// ============================================================================

/**
 * Pricing information for a model
 */
export type LLMModelPricing = {
  inputCostPerToken: number;
  outputCostPerToken: number;
  // Optional extended pricing fields
  inputCacheReadPerToken?: number;
  inputCacheWritePerToken?: number;
  imageCostPerToken?: number;
  imageOutputCostPerToken?: number;
  audioCostPerToken?: number;
  internalReasoningCostPerToken?: number;
  webSearchCostPerQuery?: number;
};

// ============================================================================
// Reasoning Configuration Types
// ============================================================================

export type ReasoningEffortOption =
  | "none"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

/**
 * Reasoning/thinking parameter configuration for a model
 */
export type ReasoningConfig = {
  /** Whether reasoning/thinking is supported */
  supported: boolean;
  /** Parameter name used in API (reasoning_effort, effort, thinkingLevel, etc.) */
  parameterName: string;
  /** Allowed values for this model */
  allowedValues: ReasoningEffortOption[];
  /** Default value if not specified */
  defaultValue: ReasoningEffortOption;
  /** Whether reasoning can be disabled (set to none) */
  canDisable: boolean;
};

// ============================================================================
// Model Entry Type
// ============================================================================

/**
 * A single LLM model entry
 */
export type LLMModelEntry = {
  /** Full model ID, e.g. "openai/gpt-5" */
  id: string;
  /** Human-readable name, e.g. "GPT-5" */
  name: string;
  /** Provider key (may be mapped from source format) */
  provider: string;
  /** Pricing information */
  pricing: LLMModelPricing;
  /** Maximum context window size in tokens */
  contextLength: number;
  /** Maximum completion/output tokens (null if not specified) */
  maxCompletionTokens: number | null;
  /** List of supported API parameters */
  supportedParameters: string[];
  /** Default parameter values (null if not specified) */
  defaultParameters: Record<string, unknown> | null;
  /** Raw modality string, e.g. "text->text" */
  modality: string;
  /** Derived mode: "chat" or "embedding" */
  mode: "chat" | "embedding";
  /** Model description (optional) */
  description?: string;
  // Multimodal support flags
  supportsImageInput: boolean;
  supportsAudioInput: boolean;
  supportsImageOutput: boolean;
  supportsAudioOutput: boolean;
  /** Reasoning/thinking configuration (undefined if not supported) */
  reasoningConfig?: ReasoningConfig;
};

// ============================================================================
// Registry Type
// ============================================================================

/**
 * The complete model registry format (llmModels.json)
 */
export type LLMModelRegistry = {
  /** ISO timestamp of when the registry was last updated */
  updatedAt: string;
  /** Total number of models in the registry */
  modelCount: number;
  /** All models indexed by their full ID */
  models: Record<string, LLMModelEntry>;
};

// ============================================================================
// Provider Mapping
// ============================================================================

/**
 * Mapping from external provider names to our internal provider keys
 */
export type ProviderMapping = Record<string, string>;

/**
 * Default provider mapping
 * Maps OpenRouter provider names to litellm/internal format where they differ
 */
export const DEFAULT_PROVIDER_MAPPING: ProviderMapping = {
  // These are mappings where source differs from litellm
  google: "gemini",
  "x-ai": "xai",
  // Most providers match directly and don't need mapping
};
