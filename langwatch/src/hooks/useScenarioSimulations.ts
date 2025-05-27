import useSWR from "swr";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { MessageRole } from "@copilotkit/runtime-client-gql";

export const useFetchScenarioRuns = (options?: {
  refreshInterval?: number;
  revalidateOnFocus?: boolean;
}) => {
  const { project } = useOrganizationTeamProject();
  return useSWR<{ scenarioRunIds: string[] }>(
    project ? `/api/scenario-events/scenario-runs` : null,
    async () => {
      const res = await fetch("/api/scenario-events/scenario-runs", {
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
  return useSWR<{
    state: {
      messages: { role: MessageRole; content: string }[];
      status: "success" | "failure" | "in-progress";
    };
  }>(
    project ? `/api/scenario-events/scenario-run/${scenarioRunId}` : null,
    async () => {
      const res = await fetch(
        `/api/scenario-events/scenario-run/${scenarioRunId}`,
        {
          headers: {
            "X-Auth-Token": project?.apiKey ?? "",
          },
        }
      );
      return res.json();
    },
    {
      refreshInterval: 1000, // Poll every second
      revalidateOnFocus: true, // Revalidate when window regains focus
      ...options,
    }
  );
};
