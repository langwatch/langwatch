import { api } from "~/utils/api";

/**
 * Mutation for pushing agent config to replicas. On success, invalidates
 * agents list for the project so the UI stays in sync.
 */
export function usePushAgentToCopies() {
  const utils = api.useContext();
  return api.agents.pushToCopies.useMutation({
    onSuccess: (_data, variables) => {
      void utils.agents.getAll.invalidate({ projectId: variables.projectId });
    },
  });
}
