import { scenarioClient } from "@langwatch/scenario-client";

/** One active scenario by id, read only while there is an id to read. */
export function useScenario({
  projectId,
  id,
  enabled = true,
}: {
  projectId: string | undefined;
  id: string | undefined;
  enabled?: boolean;
}) {
  return scenarioClient.scenarios.getById.useQuery(
    { projectId: projectId ?? "", id: id ?? "" },
    { enabled: !!projectId && !!id && enabled },
  );
}
