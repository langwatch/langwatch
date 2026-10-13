import { LANGY_CHAT_FEATURE_KEY, type ModelProviderApi } from "@langwatch/model-provider-contract";

/** Resolves the project-configured model for a Langy turn. */
export abstract class LangyModel {
  abstract resolve(input: { projectId: string }): Promise<{ modelId: string }>;
}

/** The project's Langy model, refused when the provider it names is absent or switched off. */
export class LangyModelService extends LangyModel {
  private constructor(
    private readonly modelProviders: Pick<
      ModelProviderApi,
      "resolveModelForFeature" | "getExecutionProviders"
    >,
  ) {
    super();
  }

  static create(input: {
    modelProviders: Pick<ModelProviderApi, "resolveModelForFeature" | "getExecutionProviders">;
  }): LangyModelService {
    return new LangyModelService(input.modelProviders);
  }

  async resolve({ projectId }: { projectId: string }): Promise<{ modelId: string }> {
    const [resolved, providers] = await Promise.all([
      this.modelProviders.resolveModelForFeature({
        projectId,
        featureKey: LANGY_CHAT_FEATURE_KEY,
      }),
      this.modelProviders.getExecutionProviders({ projectId }),
    ]);
    const providerKey = resolved.model.split("/")[0] ?? "";
    const provider = providers[providerKey];
    if (!provider) {
      throw new Error(`Model provider "${providerKey}" is not configured for this project.`);
    }
    if (!provider.enabled) {
      throw new Error(`Model provider "${providerKey}" is configured but disabled.`);
    }

    return { modelId: resolved.model };
  }
}
