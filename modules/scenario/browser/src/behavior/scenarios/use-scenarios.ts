import { scenarioClient } from "@langwatch/scenario-client";

/** The project's active scenarios; the one read every scenario surface shares. */
export function useScenarios({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return scenarioClient.scenarios.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}
