/**
 * The built-in judge models a project may pick: Instant Evals, when the server releases it, plus
 * the project's own decision models. The server weighs every flag, the opt-in, a self-hosted
 * license and the provider keys, so none of them is read here.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { INSTANT_EVAL_JUDGE_MODEL_ID } from "@langwatch/instant-eval-judge-contract";
import type { BuiltInModel } from "@langwatch/model-provider-contract";
import { useMemo } from "react";

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
  const released = !!access.data?.released;
  const decisionModels = evaluatorApi.modelProvider.listDecisionModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && released, staleTime: 5 * 60 * 1000 },
  );

  // One identity per answer, so the picker's `useMemo` and `React.memo` are not defeated per
  // render. Memoised above the release gate: a hook may not run only on some renders.
  const offered = decisionModels.data;
  const builtInModels = useMemo(() => {
    // Instant Evals keeps its own name and its place first; the server's hosted entry is its twin.
    const own = (offered ?? []).filter(
      (model) => model.value !== INSTANT_EVALS_BUILT_IN_MODEL.value,
    );
    return own.length === 0 ? RELEASED : [INSTANT_EVALS_BUILT_IN_MODEL, ...own];
  }, [offered]);

  if (!released) return { builtInModels: NONE, isLoading: access.isLoading };

  return { builtInModels, isLoading: decisionModels.isLoading };
}
