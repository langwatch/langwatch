import { agentApi } from "./agent-api.ts";

/** The project's agents, every type, each with its copy count. */
export function useAgents({ projectId }: { projectId: string | undefined }) {
  return agentApi.agents.getAll.useQuery(
    { projectId: projectId ?? "" },
    { enabled: Boolean(projectId) },
  );
}
