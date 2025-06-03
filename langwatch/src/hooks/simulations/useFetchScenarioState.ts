import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunStateRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getScenarioRunState =
  hc<GetScenarioRunStateRouteType>("/").api["scenario-events"]["scenario-runs"][
    "state"
  ][":id"].$get;

/**
 * Fetch the state of a scenario run
 * @param scenarioRunId - The ID of the scenario run
 * @param options - Options for the SWR hook
 * @returns Scenario run state
 */
export const useFetchScenarioState = ({
  scenarioRunId,
  options,
}: {
  scenarioRunId: string;
  options?: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
  };
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey = project
    ? `scenario-events/scenario-runs/state/${scenarioRunId}`
    : null;

  return useSWR(
    cacheKey,
    async () => {
      const res = await getScenarioRunState(
        {
          param: {
            id: scenarioRunId,
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
        throw new Error(response.error);
      }

      return response.state;
    },
    {
      refreshInterval: 1000,
      revalidateOnFocus: true,
      ...options,
    }
  );
};
