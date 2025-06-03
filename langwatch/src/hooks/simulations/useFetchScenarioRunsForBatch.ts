import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunsForBatchRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getScenarioRunsForBatch =
  hc<GetScenarioRunsForBatchRouteType>("/").api["scenario-events"][
    "batch-runs"
  ][":id"]["scenario-runs"].$get;

/**
 * Fetch scenario runs for a specific batch
 * @param batchRunId - The ID of the batch run
 * @param options - Options for the SWR hook
 * @returns Scenario run IDs for the batch
 */
export const useFetchScenarioRunsForBatch = ({
  batchRunId,
  options,
}: {
  batchRunId: string | null;
  options?: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
  };
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey =
    project && batchRunId
      ? `scenario-events/batch-runs/${batchRunId}/scenario-runs`
      : null;

  return useSWR(
    cacheKey,
    async () => {
      if (!batchRunId) return [];

      const res = await getScenarioRunsForBatch(
        {
          param: {
            id: batchRunId,
          },
        },
        {
          headers: {
            "X-Auth-Token": project?.apiKey ?? "",
          },
        }
      );
      const response = await res.json();
      return response.ids;
    },
    options
  );
};
