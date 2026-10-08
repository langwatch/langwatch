/**
 * The built-in models the picker on `evaluatorType` hands its member. Instant Evals is
 * released by the flag or the organization's own opt-in (ADR-174 decision 11).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { useFeatureFlag } from "@langwatch/browser-host/feature-flag";
import { INSTANT_EVALS_FLAG } from "@langwatch/instant-eval-contract";
import type { BuiltInModel } from "@langwatch/model-provider-contract";

import {
  instantEvalJudgeModelsOf,
  isInstantEvalJudgeSlot,
} from "../model/instant-eval-judge-models.ts";
import { evaluatorApi } from "./evaluator-api.ts";

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
  released: boolean;
  offered: boolean;
  isLoading: boolean;
} {
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
    ...instantEvalJudgeModelsOf({ evaluatorType, released }),
    released,
    // Only a judge waits on release: no other evaluator is offered Instant Evals either way.
    isLoading:
      isInstantEvalJudgeSlot({ evaluatorType }) &&
      !released &&
      (flag.isLoading || access.isLoading),
  };
}
