/**
 * The built-in judge models a project may pick: Instant Preview, when the server releases it, then
 * Evals Preview where the judge router flag is on, and the project's own decision models whether or
 * not Instant Evals are released. The server weighs the opt-in, a license and the provider keys.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useFeatureFlag } from "@langwatch/feature-flag-client";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import { LANGWATCH_EVALS_MODEL_ID, type BuiltInModel } from "@langwatch/model-provider-contract";

import { evaluatorApi } from "./evaluator-api.ts";

/** How the picker names LangWatch's hosted judge. */
export const INSTANT_EVALS_BUILT_IN_MODEL: BuiltInModel = {
  value: INSTANT_EVAL_JUDGE_MODEL_ID,
  label: "Instant Preview",
};

/** The judge router (ADR-190), offered to an LLM judge where its flag is on. */
export const EVALS_PREVIEW_BUILT_IN_MODEL: BuiltInModel = {
  value: LANGWATCH_EVALS_MODEL_ID,
  label: "Evals Preview",
};

const RELEASED: readonly BuiltInModel[] = [INSTANT_EVALS_BUILT_IN_MODEL];
const RELEASED_ROUTED: readonly BuiltInModel[] = [
  INSTANT_EVALS_BUILT_IN_MODEL,
  EVALS_PREVIEW_BUILT_IN_MODEL,
];
const NONE: readonly BuiltInModel[] = [];
const HOSTED_IDS: ReadonlySet<string> = new Set(RELEASED_ROUTED.map((model) => model.value));

export function useInstantEvalJudgeModels({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}): {
  builtInModels: readonly BuiltInModel[];
  isJudgeRouted: boolean;
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
  const { enabled: isJudgeRouted } = useFeatureFlag(
    FrontendFlags.release_instant_evals_judge_router,
    { projectId, organizationId, enabled: !!projectId && !!organizationId },
  );
  // LangWatch's models keep their names and place first; the server's hosted entries are twins.
  const own = (decisionModels.data ?? []).filter((model) => !HOSTED_IDS.has(model.value));
  const released = isJudgeRouted ? RELEASED_ROUTED : RELEASED;
  const hosted = access.data?.hostedReleased ? released : NONE;

  return {
    builtInModels: own.length === 0 ? hosted : [...hosted, ...own],
    isJudgeRouted,
    isLoading: access.isLoading || decisionModels.isLoading,
  };
}
