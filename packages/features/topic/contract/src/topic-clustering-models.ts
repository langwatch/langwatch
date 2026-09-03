/**
 * Portable model-resolution boundary used by Topic clustering. The concrete
 * adapter belongs to Model Provider, which owns provider credentials and the
 * project-level model cascade.
 */
export interface TopicClusteringProviderConfig {
  readonly enabled: boolean;
}

export abstract class TopicClusteringModelsPort<
  ProviderConfig extends TopicClusteringProviderConfig = TopicClusteringProviderConfig,
> {
  abstract resolveClusteringModel(projectId: string): Promise<{ model: string }>;

  abstract findExecutionProviders(projectId: string): Promise<Record<string, ProviderConfig>>;

  abstract resolveEmbeddingsModel(
    projectId: string,
  ): Promise<{ model: string; modelProvider: ProviderConfig }>;

  abstract prepareLitellmParams(params: {
    model: string;
    modelProvider: ProviderConfig;
    projectId: string;
  }): Promise<Record<string, string>>;
}
