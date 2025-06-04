import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type { GetScenarioRunStateRouteType } from "~/app/api/scenario-events/[[...route]]/app";
import { useEffect } from "react";
import { useState } from "react";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/schemas";

const getScenarioRunData =
  hc<GetScenarioRunStateRouteType>("/").api["scenario-events"]["scenario-runs"][
    "state"
  ][":id"].$get;

/**
 * Fetch the state of a scenario run.
 * By default, the refresh interval is 1000ms and will stop when the scenario run is complete.
 * Setting the refresh interval in the options will override the default behavior.
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
  const [refreshInterval, setRefreshInterval] = useState(
    options?.refreshInterval ?? 1000
  );
  const { project } = useOrganizationTeamProject();
  const cacheKey = project
    ? `scenario-events/scenario-runs/state/${scenarioRunId}`
    : null;

  const { data, ...rest } = useSWR(
    cacheKey,
    async () => {
      const res = await getScenarioRunData(
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

      return response;
    },
    {
      refreshInterval,
      revalidateOnFocus: true,
      ...options,
    }
  );

  useEffect(() => {
    if (options?.refreshInterval) return;
    if (data?.status !== ScenarioRunStatus.IN_PROGRESS) {
      setRefreshInterval(0);
    }
  }, [data, options?.refreshInterval]);

  return {
    data,
    ...rest,
  };
};
