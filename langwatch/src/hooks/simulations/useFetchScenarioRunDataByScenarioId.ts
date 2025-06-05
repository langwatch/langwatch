import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunDataByScenarioIdRouteType } from "~/app/api/scenario-events/[[...route]]/app";

// Create a client for the scenario run data endpoint
const getScenarioRunDataByScenarioId =
  hc<GetScenarioRunDataByScenarioIdRouteType>("/").api["scenario-events"][
    "scenario-runs"
  ]["data-by-scenario-id"][":scenarioId"].$get;

/**
 * Fetch all scenario run data for a given scenarioId.
 * @param scenarioId - The scenario ID to fetch run data for
 * @param options - SWR options
 * @returns SWR response with scenario run data array
 */
export const useFetchScenarioRunDataByScenarioId = ({
  scenarioId,
  options,
}: {
  scenarioId?: string;
  options?: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
  };
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey = project
    ? `scenario-events/scenario-runs/data-by-scenario-id/${scenarioId}`
    : null;

  return useSWR(
    cacheKey,
    async () => {
      if (!scenarioId) return { data: [] };

      // Call the API endpoint with the scenarioId and project API key
      const res = await getScenarioRunDataByScenarioId(
        {
          param: {
            scenarioId,
          },
        },
        {
          headers: {
            "X-Auth-Token": project?.apiKey ?? "",
          },
        }
      );

      const response = await res.json();

      if ("error" in response) {
        throw new Error(response.error as string);
      }

      // The API returns { data: ScenarioRunData[] | null }
      return { data: response.data ?? [] };
    },
    {
      enabled: !!scenarioId,
      refreshInterval: options?.refreshInterval,
      revalidateOnFocus: options?.revalidateOnFocus ?? true,
      ...options,
    }
  );
};
