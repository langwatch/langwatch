import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunDataForBatchRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getScenarioRunDataForBatch =
  hc<GetScenarioRunDataForBatchRouteType>("/").api["scenario-events"][
    "batch-runs"
  ][":id"]["scenario-runs"].$get;

/**
 * Fetch scenario runs for a specific batch
 * @param batchRunId - The ID of the batch run
 * @param options - Options for the SWR hook
 * @returns Scenario run IDs for the batch
 */
export const useFetchScenarioRunDataForBatch = ({
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
      ? `scenario-events/batch-runs/${batchRunId}/scenario-runs/data`
      : null;

  return useSWR(
    cacheKey,
    async () => {
      if (!batchRunId) return [];

      const res = await getScenarioRunDataForBatch(
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
      return response.data;
    },
    options
  );
};
