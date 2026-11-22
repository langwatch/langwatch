import { scenarioClient } from "@langwatch/scenario-client";

import { api } from "../scenario-api.ts";

type SummaryWindow = {
  projectId: string | undefined;
  startDate: number;
  endDate: number;
};

/** Per-suite run summaries over a window. */
export function useSuiteSummaries({ projectId, startDate, endDate }: SummaryWindow) {
  return api.suites.getSummaries.useQuery(
    { projectId: projectId ?? "", startDate, endDate },
    {
      enabled: !!projectId,
    },
  );
}

/** Per-set run summaries for runs the SDK reported without a suite, over a window. */
export function useExternalSetSummaries({ projectId, startDate, endDate }: SummaryWindow) {
  return scenarioClient.scenarios.getExternalSetSummaries.useQuery(
    { projectId: projectId ?? "", startDate, endDate },
    {
      enabled: !!projectId,
    },
  );
}
