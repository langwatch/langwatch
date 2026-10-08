/**
 * The chat model a new evaluator starts on when the project resolves no default: Instant
 * Evals for an LLM judge in a released project with no model provider, which could run
 * nothing else, and the platform default otherwise.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { isLlmJudgeEvaluator } from "@langwatch/evaluator-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { allModelOptions, DEFAULT_MODEL } from "@langwatch/model-provider-contract";

import { useInstantEvalJudgeModels } from "./use-instant-eval-judge-models.ts";
import { useModelSelection } from "./use-model-selection.ts";

export function useEvaluatorFallbackModel({
  evaluatorType,
}: {
  evaluatorType: string | undefined;
}) {
  const { project, organization } = useOrganizationTeamProject();
  const instantEvals = useInstantEvalJudgeModels({
    projectId: project?.id,
    organizationId: organization?.id,
  });
  const providerModels = useModelSelection({ options: allModelOptions, model: "", mode: "chat" });
  const isInstantEvals =
    !!evaluatorType &&
    isLlmJudgeEvaluator(evaluatorType) &&
    instantEvals.released &&
    providerModels.isEmpty;

  return {
    fallbackModel: isInstantEvals ? INSTANT_EVAL_JUDGE_MODEL_ID : DEFAULT_MODEL,
    isLoading: instantEvals.isLoading || providerModels.isLoading,
  };
}
