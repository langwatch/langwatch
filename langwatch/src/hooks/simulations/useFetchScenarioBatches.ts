import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetBatchRunIdsRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getAllBatchRunsForProject =
  hc<GetBatchRunIdsRouteType>("/").api["scenario-events"]["batch-runs"]["ids"]
    .$get;

/**
 * Fetch all batch runs for a project
 * @param options - Options for the SWR hook
 * @returns Batch run IDs with scenario counts
 */
export const useFetchScenarioBatches = (options?: {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey = project ? "scenario-events/batch-runs/ids" : null;

  return useSWR(
    cacheKey,
    async () => {
      const res = await getAllBatchRunsForProject(
        {},
        {
          headers: {
            "X-Auth-Token": project?.apiKey ?? "",
          },
        }
      );
      const response = await res.json();
      return response.batches;
    },
    options
  );
};
