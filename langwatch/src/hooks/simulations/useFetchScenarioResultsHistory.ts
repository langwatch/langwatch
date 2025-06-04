import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunFinishedEventsByScenarioIdRouteType } from "~/app/api/scenario-events/[[...route]]/app";

const getScenarioRunFinishedEventsByScenarioId =
  hc<GetScenarioRunFinishedEventsByScenarioIdRouteType>("/").api[
    "scenario-events"
  ]["scenario-runs"]["finished-events"][":id"].$get;

/**
 * Fetch the history of a scenario run.
 * @param scenarioRunId - The ID of the scenario run
 * @param options - Options for the SWR hook
 * @returns Scenario run history
 */
export const useFetchScenarioResultsHistory = ({
  scenarioId,
  options,
}: {
  scenarioId: string;
  options?: {
    refreshInterval?: number;
    revalidateOnFocus?: boolean;
  };
}) => {
  const { project } = useOrganizationTeamProject();
  const cacheKey = project
    ? `scenario-events/scenario-runs/finished-events/${scenarioId}`
    : null;

  return useSWR(
    cacheKey,
    async () => {
      const res = await getScenarioRunFinishedEventsByScenarioId(
        {
          param: {
            id: scenarioId,
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

      return { history: response.results };
    },
    {
      refreshInterval: options?.refreshInterval,
      revalidateOnFocus: options?.revalidateOnFocus ?? true,
      ...options,
    }
  );
};
