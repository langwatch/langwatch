/**
 * The built-in judge models a project may pick: Instant Evals, when the server releases it, and
 * the project's own decision models, whether or not Instant Evals are released. The server weighs
 * every flag, the opt-in, a self-hosted license and the provider keys, so none is read here.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import type { BuiltInModel } from "@langwatch/model-provider-contract";

import { evaluatorApi } from "./evaluator-api.ts";

/** How the picker names Instant Evals. */
export const INSTANT_EVALS_BUILT_IN_MODEL: BuiltInModel = {
  value: INSTANT_EVAL_JUDGE_MODEL_ID,
  label: "Instant Evals",
};

const RELEASED: readonly BuiltInModel[] = [INSTANT_EVALS_BUILT_IN_MODEL];
const NONE: readonly BuiltInModel[] = [];

export function useInstantEvalJudgeModels({ projectId }: { projectId: string | undefined }): {
  builtInModels: readonly BuiltInModel[];
  isLoading: boolean;
} {
  const access = evaluatorApi.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: 5 * 60 * 1000 },
  );
  // Own models answer to their own flag on the server, never to the Instant Evals release.
  const decisionModels = evaluatorApi.modelProvider.listDecisionModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  );
  // Instant Evals keeps its own name and its place first; the server's hosted entry is its twin.
  const own = (decisionModels.data ?? []).filter(
    (model) => model.value !== INSTANT_EVALS_BUILT_IN_MODEL.value,
  );
  const hosted = access.data?.hostedReleased ? RELEASED : NONE;

  return {
    builtInModels: own.length === 0 ? hosted : [...hosted, ...own],
    isLoading: access.isLoading || decisionModels.isLoading,
  };
}
