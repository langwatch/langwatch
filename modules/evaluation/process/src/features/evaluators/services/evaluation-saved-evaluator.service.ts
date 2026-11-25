import type {
  SavedEvaluatorLookup,
  SavedEvaluatorResolution,
} from "@langwatch/evaluation-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";

/** The saved evaluator an `evaluators/{slug|id}` call names, resolved by its owner. */
export class EvaluationSavedEvaluatorService {
  private constructor(private readonly evaluators: Pick<EvaluatorApi, "resolveForExecution">) {}

  static create(
    evaluators: Pick<EvaluatorApi, "resolveForExecution">,
  ): EvaluationSavedEvaluatorService {
    return new EvaluationSavedEvaluatorService(evaluators);
  }

  async resolveForExecution(input: SavedEvaluatorLookup): Promise<SavedEvaluatorResolution> {
    const resolved = await this.evaluators.resolveForExecution({
      idOrSlug: input.idOrSlug,
      projectId: input.projectId,
    });

    return {
      checkType: resolved.checkType,
      settings: resolved.settings ?? {},
      name: resolved.name,
      evaluatorId: resolved.evaluatorId,
      requiredFields: resolved.requiredFields,
    };
  }
}
