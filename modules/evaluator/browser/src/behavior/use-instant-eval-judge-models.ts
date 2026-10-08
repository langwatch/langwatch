/**
 * The built-in judge models a project may pick: Instant Evals, when the release
 * flag or the organization's own opt-in releases it (ADR-174 decision 11).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";
import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";
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

export function useInstantEvalJudgeModels({
  projectId,
  organizationId,
}: {
  projectId: string | undefined;
  organizationId: string | undefined;
}): { builtInModels: readonly BuiltInModel[]; released: boolean; isLoading: boolean } {
  const flag = useFeatureFlag(INSTANT_EVALS_FLAG, {
    projectId,
    organizationId,
    enabled: !!projectId && !!organizationId,
  });
  const access = evaluatorApi.traces.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId, staleTime: 5 * 60 * 1000 },
  );
  const released = flag.enabled || !!access.data?.released;

  return {
    builtInModels: released ? RELEASED : NONE,
    released,
    isLoading: !released && (flag.isLoading || access.isLoading),
  };
}
