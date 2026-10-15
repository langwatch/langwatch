/**
 * The built-in judge models a project may pick: Instant Evals, when the server releases it. The
 * server weighs the flag, the opt-in and a self-hosted license, so the flag is never read here.
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
  const released = !!access.data?.released;

  return {
    builtInModels: released ? RELEASED : NONE,
    isLoading: !released && access.isLoading,
  };
}
