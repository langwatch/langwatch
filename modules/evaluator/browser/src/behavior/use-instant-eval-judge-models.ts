/**
 * The built-in judge models a project may pick: LangWatch's hosted model, when the server releases
 * it, then the project's own decision models, only for the evaluators Instant Evals answers. The
 * hosted pick is saved as the written id and named by the router flag (ADR-182, ADR-190).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import {
  INSTANT_EVAL_JUDGE_MODEL_ID,
  isInstantEvalJudgeEvaluatorType,
} from "@langwatch/instant-eval-judge-contract";
import {
  findDecisionModel,
  isLangWatchDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
  LANGWATCH_EVALS_MODEL_ID,
  type BuiltInModel,
} from "@langwatch/model-provider-contract";

import { evaluatorApi } from "./evaluator-api.ts";

/** LangWatch's hosted judge where the router flag is off: the decision model alone. */
export const INSTANT_EVALS_BUILT_IN_MODEL: BuiltInModel = {
  value: INSTANT_EVAL_JUDGE_MODEL_ID,
  label: "LangWatch Instant (preview)",
};

/** The same saved id where the router flag is on: the judge router answers it (ADR-190). */
export const EVALS_PREVIEW_BUILT_IN_MODEL: BuiltInModel = {
  value: INSTANT_EVAL_JUDGE_MODEL_ID,
  label: "LangWatch Evals (preview)",
  description: findDecisionModel(LANGWATCH_EVALS_MODEL_ID)?.description,
};

/**
 * A judge saved on the LangWatch Instant (preview) id where the flag is on is never routed; named
 * only.
 */
const INSTANT_PREVIEW_SHOWN: BuiltInModel = {
  value: LANGWATCH_DECISION_MODEL_ID,
  label: "LangWatch Instant (preview)",
};

const NONE: readonly BuiltInModel[] = [];

export function useInstantEvalJudgeModels({
  projectId,
  organizationId,
  evaluatorType,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
  evaluatorType: string | undefined;
}): {
  builtInModels: readonly BuiltInModel[];
  /** The picker's models plus any name a stored hosted id shows as. */
  shownModels: readonly BuiltInModel[];
  isJudgeRouted: boolean;
  isLoading: boolean;
} {
  const isAnswered = !!projectId && isInstantEvalJudgeEvaluatorType(evaluatorType);
  const access = evaluatorApi.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isAnswered, staleTime: 5 * 60 * 1000 },
  );
  // Own models answer to their own flag on the server, never to the Instant Evals release.
  const decisionModels = evaluatorApi.modelProvider.listDecisionModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: isAnswered },
  );
  const router = useFeatureFlag(FrontendFlags.release_instant_evals_judge_router, {
    projectId,
    organizationId,
    enabled: isAnswered && !!organizationId,
  });
  if (!isAnswered) {
    return { builtInModels: NONE, shownModels: NONE, isJudgeRouted: false, isLoading: false };
  }
  const isJudgeRouted = router.enabled;
  // LangWatch's model keeps its name and place first; the server's hosted entries are twins.
  const own = (decisionModels.data ?? []).filter(
    (model) => !isLangWatchDecisionModelId(model.value),
  );
  const offered = isJudgeRouted ? EVALS_PREVIEW_BUILT_IN_MODEL : INSTANT_EVALS_BUILT_IN_MODEL;
  const hosted = access.data?.hostedReleased ? [offered] : NONE;
  const builtInModels = own.length === 0 ? hosted : [...hosted, ...own];

  return {
    builtInModels,
    shownModels:
      isJudgeRouted && hosted.length > 0
        ? [...builtInModels, INSTANT_PREVIEW_SHOWN]
        : builtInModels,
    isJudgeRouted,
    isLoading: access.isLoading || decisionModels.isLoading || router.isLoading,
  };
}
