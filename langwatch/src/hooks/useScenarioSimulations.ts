import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { hc } from "hono/client";
import type {
  GetScenarioRunIdsRouteType,
  GetScenarioRunStateRouteType,
  GetBatchRunIdsRouteType,
  GetScenarioRunsForBatchRouteType,
} from "~/app/api/scenario-events/[[...route]]/app";

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
