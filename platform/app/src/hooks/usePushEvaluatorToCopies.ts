import { api } from "~/utils/api";

/**
 * Mutation for pushing evaluator config to replicas. On success, invalidates
 * evaluators list for the project so the UI stays in sync.
 */
export function usePushEvaluatorToCopies() {
  const utils = api.useContext();
  return api.evaluators.pushToCopies.useMutation({
    onSuccess: (_data, variables) => {
      void utils.evaluators.getAll.invalidate({
        projectId: variables.projectId,
      });
    },
  });
}
