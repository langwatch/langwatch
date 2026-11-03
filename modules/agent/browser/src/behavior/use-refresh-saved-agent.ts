import { agentApi } from "./agent-api.ts";

/**
 * Marks every read of a saved agent stale in this tab at once: the list, the agent at any label
 * or version, its versions and its history. Other tabs follow the `lw.agent.changed` read hint.
 */
export function useRefreshSavedAgent({ projectId }: { projectId: string }) {
  const utils = agentApi.useUtils();
  return async ({ agentId }: { agentId: string }): Promise<void> => {
    await Promise.all([
      utils.agents.getAll.invalidate({ projectId }),
      utils.agents.getById.invalidate({ id: agentId, projectId }),
      utils.agents.listVersions.invalidate({ agentId, projectId }),
      utils.agents.getHistory.invalidate({ agentId, projectId }),
    ]);
  };
}
