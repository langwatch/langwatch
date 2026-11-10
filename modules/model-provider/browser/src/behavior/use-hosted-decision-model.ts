/**
 * Whether Default models may offer LangWatch's hosted decision model (Evals Preview), as the
 * server answers it: released, or one switch away for a self-serve organization. Everywhere else
 * the column lists only the project's own decision models and an unset column reads "Not set".
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
