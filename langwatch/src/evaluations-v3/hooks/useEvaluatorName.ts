import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { EvaluatorConfig } from "../types";

/**
 * Hook to fetch the display name for an evaluator from the database.
 * Returns the name from the loaded evaluator entity.
 * Returns empty string while loading.
 */
export const useEvaluatorName = (evaluator: EvaluatorConfig): string => {
  const { project } = useOrganizationTeamProject();

  const { data: dbEvaluator, isLoading } = api.evaluators.getById.useQuery(
    {
      id: evaluator.dbEvaluatorId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!evaluator.dbEvaluatorId && !!project?.id,
    }
  );

  if (isLoading) return "";
  return dbEvaluator?.name ?? "";
};
