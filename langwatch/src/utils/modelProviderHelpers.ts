/**
 * Utility functions for working with model providers
 * These helpers extract provider information and check provider usage across the application
 */

import {
  DEFAULT_EMBEDDINGS_MODEL,
  DEFAULT_MODEL,
  DEFAULT_TOPIC_CLUSTERING_MODEL,
} from "./constants";

/**
 * Extract the provider key from a model string
 * 
 * @param model - The full model identifier (e.g., "openai/gpt-4", "anthropic/claude-3")
 * @returns The provider key (e.g., "openai", "anthropic")
 * 
 * @example
 * getProviderFromModel("openai/gpt-4") // Returns: "openai"
 * getProviderFromModel("anthropic/claude-3-opus") // Returns: "anthropic"
 */
export function getProviderFromModel(model: string): string {
  return model.split("/")[0] ?? "";
}

/**
 * Effective defaults for models - uses project values when set, otherwise falls back to constants
 */
export type EffectiveDefaults = {
  defaultModel: string;
  topicClusteringModel: string;
  embeddingsModel: string;
};

/**
 * Get effective default models for a project
 * Returns project values when set, otherwise falls back to DEFAULT_* constants
 * 
 * @param project - The project object with optional default model fields
 * @returns The effective defaults to use throughout the application
 * 
 * @example
 * getEffectiveDefaults({ defaultModel: "anthropic/claude-3", topicClusteringModel: null, embeddingsModel: null })
 * // Returns: { defaultModel: "anthropic/claude-3", topicClusteringModel: DEFAULT_TOPIC_CLUSTERING_MODEL, embeddingsModel: DEFAULT_EMBEDDINGS_MODEL }
 */
export function getEffectiveDefaults(
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined
): EffectiveDefaults {
  return {
    defaultModel: project?.defaultModel ?? DEFAULT_MODEL,
    topicClusteringModel: project?.topicClusteringModel ?? DEFAULT_TOPIC_CLUSTERING_MODEL,
    embeddingsModel: project?.embeddingsModel ?? DEFAULT_EMBEDDINGS_MODEL,
  };
}

/**
 * Check if a provider is used for any of the effective default models
 * Uses the unified effective defaults logic (project values when set, otherwise constants)
 * 
 * @param providerKey - The provider key to check (e.g., "openai", "anthropic")
 * @param project - The project object with optional default model fields
 * @returns True if the provider is used for any effective default model
 */
export function isProviderEffectiveDefault(
  providerKey: string,
  project: {
    defaultModel?: string | null;
    topicClusteringModel?: string | null;
    embeddingsModel?: string | null;
  } | null | undefined
): boolean {
  const effectiveDefaults = getEffectiveDefaults(project);
  return isProviderUsedForDefaultModels(
    providerKey,
    effectiveDefaults.defaultModel,
    effectiveDefaults.topicClusteringModel,
    effectiveDefaults.embeddingsModel
  );
}

/**
 * Check if a provider is used for the Default Model only (not topic clustering or embeddings)
 * 
 * @param providerKey - The provider key to check (e.g., "openai", "anthropic")
 * @param project - The project object with optional default model field
 * @returns True if the provider is used for the default model
 */
export function isProviderDefaultModel(
  providerKey: string,
  project: {
    defaultModel?: string | null;
  } | null | undefined
): boolean {
  const effectiveDefault = project?.defaultModel ?? DEFAULT_MODEL;
  return getProviderFromModel(effectiveDefault) === providerKey;
}

/**
 * Check if a provider is currently being used for any of the project's default models
 * 
 * @param providerKey - The provider key to check (e.g., "openai", "anthropic")
 * @param defaultModel - The project's default model (e.g., "openai/gpt-4")
 * @param topicClusteringModel - The project's topic clustering model
 * @param embeddingsModel - The project's embeddings model
 * @returns True if the provider is used for any default model, false otherwise
 * 
 * @example
 * isProviderUsedForDefaultModels(
 *   "openai",
 *   "openai/gpt-4",
 *   "openai/gpt-3.5-turbo",
 *   "openai/text-embedding-ada-002"
 * ) // Returns: true
 * 
 * isProviderUsedForDefaultModels(
 *   "anthropic",
 *   "openai/gpt-4",
 *   null,
 *   null
 * ) // Returns: false
 */
export function isProviderUsedForDefaultModels(
  providerKey: string,
  defaultModel: string | null,
  topicClusteringModel: string | null,
  embeddingsModel: string | null
): boolean {
  const defaultProvider = defaultModel ? getProviderFromModel(defaultModel) : null;
  const topicClusteringProvider = topicClusteringModel
    ? getProviderFromModel(topicClusteringModel)
    : null;
  const embeddingsProvider = embeddingsModel
    ? getProviderFromModel(embeddingsModel)
    : null;

  return (
    providerKey === defaultProvider ||
    providerKey === topicClusteringProvider ||
    providerKey === embeddingsProvider
  );
}

/**
 * Extract the underlying shape from a Zod schema to list credential keys.
 */
export function getSchemaShape(schema: unknown): Record<string, unknown> {
  const s = schema as { shape?: Record<string, unknown>; _def?: { schema?: { shape?: Record<string, unknown> } } };
  if (s?.shape) return s.shape;
  if (s?._def?.schema) return s._def.schema.shape ?? {};
  return {};
}

/**
 * Determine which credential keys should be visible for the active provider and mode.
 * Azure has special handling for API Gateway vs direct API keys.
 */
export function getDisplayKeysForProvider(
  providerName: string,
  useApiGateway: boolean,
  schemaShape: Record<string, unknown>,
): Record<string, unknown> {
  if (providerName === "azure") {
    if (useApiGateway) {
      return {
        AZURE_API_GATEWAY_BASE_URL: schemaShape.AZURE_API_GATEWAY_BASE_URL,
        AZURE_API_GATEWAY_VERSION: schemaShape.AZURE_API_GATEWAY_VERSION,
      };
    }
    return {
      AZURE_OPENAI_API_KEY: schemaShape.AZURE_OPENAI_API_KEY,
      AZURE_OPENAI_ENDPOINT: schemaShape.AZURE_OPENAI_ENDPOINT,
    };
  }

  return schemaShape;
}

/**
 * Build the credential form state while preserving prior user input when applicable.
 */
export function buildCustomKeyState(
  displayKeyMap: Record<string, unknown>,
  storedKeys: Record<string, unknown>,
  previousKeys?: Record<string, string>,
): Record<string, string> {
  if (previousKeys?.MANAGED) {
    return previousKeys;
  }
  const result: Record<string, string> = {};
  Object.keys(displayKeyMap ?? {}).forEach((key) => {
    if (
      previousKeys &&
      Object.prototype.hasOwnProperty.call(previousKeys, key)
    ) {
      const previousValue = previousKeys[key];
      if (typeof previousValue === "string") {
        result[key] = previousValue;
        return;
      }
    }

    const storedValue = storedKeys[key];
    result[key] = typeof storedValue === "string" ? storedValue : "";
  });

  return result;
}
