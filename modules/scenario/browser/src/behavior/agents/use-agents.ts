import { api } from "../scenario-api.ts";

/** The project's agents; the one read every scenario surface shares. */
export function useAgents({
  projectId,
  enabled = true,
}: {
  projectId: string | undefined;
  enabled?: boolean;
}) {
  return api.agents.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && enabled },
  );
}
