/**
 * Whether Default models may offer the hosted decision model LangWatch Instant (preview): released,
 * or one switch away for a self-serve organization. Elsewhere only own decision models are listed
 * and an unset column reads "Choose a decision model".
 * @see specs/model-providers/instant-evals-decision-model.feature
 */
import { isHostedDecisionModelOffered } from "../model/decision-model-options.ts";
import { modelProviderApi } from "./model-provider-api.ts";

export function useHostedDecisionModelOffered({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}): boolean {
  const access = modelProviderApi.instantEval.access.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled, staleTime: 5 * 60 * 1000 },
  );
  return isHostedDecisionModelOffered(access.data);
}
