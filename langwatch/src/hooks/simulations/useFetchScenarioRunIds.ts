import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunIdsRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getScenarioRunIds =
  hc<GetScenarioRunIdsRouteType>("/").api["scenario-events"]["scenario-runs"][
    "ids"
  ].$get;

/**
 * Fetch all scenario runs for a project
 * @param options - Options for the SWR hook
 * @returns Scenario run IDs
 */
export const useFetchScenarioRunIds = (options?: {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey = project ? "scenario-events/scenario-runs/ids" : null;

  return useSWR(
    cacheKey,
    async () => {
      const res = await getScenarioRunIds(
        {},
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
