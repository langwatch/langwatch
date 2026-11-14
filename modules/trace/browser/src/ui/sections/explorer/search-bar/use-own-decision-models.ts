/**
 * The decision models the eval popover's picker offers: what the server says this project would
 * run on, asked only while the picker shows.
 */
import { api } from "../../../../behavior/trace-api.ts";

export function useOwnDecisionModels({
  projectId,
  enabled,
}: {
  projectId: string | undefined;
  enabled: boolean;
}): { value: string; label: string }[] | undefined {
  const query = api.modelProvider.listDecisionModelsForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
  return query.data;
}
