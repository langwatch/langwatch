import { scenarioClient } from "@langwatch/scenario-client";

/** The last result of each scenario over a window, optionally narrowed to some scenarios. */
export function useLastResultSummaries({
  projectId,
  scenarioIds,
  startDate,
  endDate,
}: {
  projectId: string | undefined;
  scenarioIds?: string[];
  startDate: number;
  endDate: number;
}) {
  return scenarioClient.scenarios.getLastResultSummaries.useQuery(
    { projectId: projectId ?? "", scenarioIds, startDate, endDate },
    { enabled: !!projectId },
  );
}
