import type { EvaluationModelLookup } from "@langwatch/evaluation-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";

/** The model the project's cascade resolves for one feature, or none when nothing is set. */
export class EvaluationModelCascadeService {
  private constructor(
    private readonly modelProviders: Pick<ModelProviderApi, "findResolvedDefault">,
  ) {}

  static create(
    modelProviders: Pick<ModelProviderApi, "findResolvedDefault">,
  ): EvaluationModelCascadeService {
    return new EvaluationModelCascadeService(modelProviders);
  }

  async findModelForFeature(input: EvaluationModelLookup): Promise<string | null> {
    const resolved = await this.modelProviders.findResolvedDefault({
      projectId: input.projectId,
      featureKey: input.featureKey,
    });

    return resolved?.model ?? null;
  }
}
