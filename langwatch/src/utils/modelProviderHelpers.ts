/**
 * Utility functions for working with model providers
 * These helpers extract provider information and check provider usage across the application
 */

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
