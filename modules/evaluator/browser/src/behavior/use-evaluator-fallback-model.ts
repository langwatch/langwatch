/**
 * The chat model a new evaluator starts on when the project resolves no default, read off
 * the rule the evaluators API shares, with this member's view of release and providers.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { evaluatorFallbackModel } from "@langwatch/evaluator-contract";
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

  return {
    fallbackModel: evaluatorFallbackModel({
      evaluatorType,
      released: instantEvals.released,
      hasUsableProvider: !providerModels.isEmpty,
      platformDefault: DEFAULT_MODEL,
    }),
    isLoading: instantEvals.isLoading || providerModels.isLoading,
  };
}
