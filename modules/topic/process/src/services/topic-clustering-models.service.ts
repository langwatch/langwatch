import type { ModelProviderApi, ModelProviderExecution } from "@langwatch/model-provider-contract";
import { TopicClusteringModels } from "@langwatch/topic-contract";

const CLUSTERING_LLM_FEATURE_KEY = "analytics.topic_clustering_llm";
const CLUSTERING_EMBEDDINGS_FEATURE_KEY = "analytics.topic_clustering_embeddings";

type TopicClusteringModelProviders = Pick<
  ModelProviderApi,
  "resolveModelForFeature" | "getExecutionProviders" | "prepareExecution"
>;

/** The project's own model cascade, read through Model Provider (main's execution adapter). */
export class ModelProviderTopicClusteringModelsService extends TopicClusteringModels<ModelProviderExecution> {
  static create(options: {
    modelProviders: TopicClusteringModelProviders;
  }): ModelProviderTopicClusteringModelsService {
    return new ModelProviderTopicClusteringModelsService(options.modelProviders);
  }

  private constructor(private readonly modelProviders: TopicClusteringModelProviders) {
    super();
  }

  resolveClusteringModel(projectId: string): Promise<{ model: string }> {
    return this.modelProviders.resolveModelForFeature({
      projectId,
      featureKey: CLUSTERING_LLM_FEATURE_KEY,
    });
  }

  findExecutionProviders(projectId: string): Promise<Record<string, ModelProviderExecution>> {
    return this.modelProviders.getExecutionProviders({ projectId });
  }

  async resolveEmbeddingsModel(
    projectId: string,
  ): Promise<{ model: string; modelProvider: ModelProviderExecution }> {
    const resolved = await this.modelProviders.resolveModelForFeature({
      projectId,
      featureKey: CLUSTERING_EMBEDDINGS_FEATURE_KEY,
    });
    const provider = resolved.model.split("/")[0];
    if (!provider) throw new Error("Embeddings provider not set");

    const modelProvider = (await this.findExecutionProviders(projectId))[provider];
    if (!modelProvider) {
      throw new Error(`Embeddings model provider ${provider} not found`);
    }
    if (!modelProvider.enabled) {
      throw new Error(`Embeddings model provider ${provider} is not enabled`);
    }
    return { model: resolved.model, modelProvider };
  }

  prepareLitellmParams(params: {
    model: string;
    modelProvider: ModelProviderExecution;
    projectId: string;
  }): Promise<Record<string, string>> {
    return this.modelProviders.prepareExecution({
      model: params.model,
      projectId: params.projectId,
    });
  }
}
