/**
 * Portable model-resolution boundary used by Topic clustering. The concrete
 * adapter belongs to Model Provider, which owns provider credentials and the
 * project-level model cascade.
 */
export interface TopicClusteringProviderConfig {
  readonly enabled: boolean;
}

/**
 * One model call the clustering service makes: its litellm parameters, and the headers langevals
 * must be posted with for it (empty unless the call goes through nlpgo's proxy, ADR-203).
 */
export interface TopicClusteringModelCall {
  readonly parameters: Record<string, string>;
  readonly headers: Record<string, string>;
}

export abstract class TopicClusteringModels<
  ProviderConfig extends TopicClusteringProviderConfig = TopicClusteringProviderConfig,
> {
  abstract resolveClusteringModel(projectId: string): Promise<{ model: string }>;

  abstract findExecutionProviders(projectId: string): Promise<Record<string, ProviderConfig>>;

  abstract resolveEmbeddingsModel(
    projectId: string,
  ): Promise<{ model: string; modelProvider: ProviderConfig }>;

  abstract prepareModelCall(params: {
    model: string;
    modelProvider: ProviderConfig;
    projectId: string;
  }): Promise<TopicClusteringModelCall>;
}
