import type {
  ModelProviderExecution,
  ModelProviderService,
} from "@langwatch/model-provider-contract";
import { TopicClusteringModelsPort } from "@langwatch/topic-contract";

const CLUSTERING_LLM_FEATURE_KEY = "analytics.topic_clustering_llm";
const CLUSTERING_EMBEDDINGS_FEATURE_KEY = "analytics.topic_clustering_embeddings";

/**
 * Model Provider's execution adapter over the project model cascade. Topic
 * receives only the portable execution material it needs for langevals.
 */
export class ModelProviderExecutionAdapter extends TopicClusteringModelsPort<ModelProviderExecution> {
  static create(options: { modelProviders: ModelProviderService }): ModelProviderExecutionAdapter {
    return new ModelProviderExecutionAdapter(options.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
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

    const providers = await this.findExecutionProviders(projectId);
    const modelProvider = providers[provider];
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
