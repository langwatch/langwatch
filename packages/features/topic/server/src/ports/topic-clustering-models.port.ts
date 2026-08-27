/**
 * The clustering runner's model-resolution boundary (ADR-051): the project's
 * own clustering LLM and embeddings configuration, resolved at the project's
 * cascade by composition (feature keys `analytics.topic_clustering_llm` and
 * `analytics.topic_clustering_embeddings`), plus the litellm params handed
 * to langevals.
 *
 * `ProviderConfig` is opaque to the runner beyond `enabled` — the runner only
 * checks the flag and hands the value back to `prepareLitellmParams`.
 * Composition binds the concrete provider execution type.
 */
export interface TopicClusteringProviderConfig {
  readonly enabled: boolean;
}

export abstract class TopicClusteringModelsPort<
  ProviderConfig extends TopicClusteringProviderConfig = TopicClusteringProviderConfig,
> {
  /**
   * The project's clustering LLM at the project cascade. Throws
   * ModelNotConfiguredError when no scope sets it — nothing here catches it:
   * it propagates to the intent handler, retries through the outbox, and the
   * run records run_failed with the user-actionable model_not_configured
   * code (surfaced as guidance on the settings page).
   */
  abstract resolveClusteringModel(projectId: string): Promise<{ model: string }>;

  /** The project's execution providers, keyed by provider name. */
  abstract findExecutionProviders(
    projectId: string,
  ): Promise<Record<string, ProviderConfig>>;

  /**
   * The project's embeddings model and provider. Throws when unset or
   * disabled — embeddings are not optional for clustering.
   */
  abstract resolveEmbeddingsModel(
    projectId: string,
  ): Promise<{ model: string; modelProvider: ProviderConfig }>;

  /** The litellm params for one model invocation through langevals. */
  abstract prepareLitellmParams(params: {
    model: string;
    modelProvider: ProviderConfig;
    projectId: string;
  }): Promise<Record<string, string>>;
}
