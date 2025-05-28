import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { MessageRole } from "@copilotkit/runtime-client-gql";

const endpoints = {
  runIds: "/api/scenario-events/run-ids",
  scenarioRun: "/api/scenario-events/scenario-run",
  allRunEvents: "/api/scenario-events",
};

export const useFetchScenarioRuns = (options?: {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
}) => {
  const { project } = useOrganizationTeamProject();
  return useSWR<{ scenarioRunIds: string[] }>(
    project ? endpoints.runIds : null,
    async () => {
      const res = await fetch(endpoints.runIds, {
        headers: {
          "X-Auth-Token": project?.apiKey ?? "",
        },
      });
      return await res.json();
    },
    options
  );
};

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
  const endpoint = `${endpoints.scenarioRun}/${scenarioRunId}`;
  return useSWR<{
    state: {
      messages: { role: MessageRole; content: string }[];
      status: "success" | "failure" | "in-progress";
    };
  }>(
    project ? endpoint : null,
    async () => {
      const res = await fetch(endpoint, {
        headers: {
          "X-Auth-Token": project?.apiKey ?? "",
        },
      });
      return res.json();
    },
    {
      refreshInterval: 1000, // Poll every second
      revalidateOnFocus: true, // Revalidate when window regains focus
      ...options,
    }
  );
};
