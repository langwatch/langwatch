/**
 * The run plans of the open project, read from the three places runs land:
 * the test suites, the external sets a code run writes into, and the internal
 * set that holds the one-off runs.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { getOnPlatformSetId } from "~/server/scenarios/internal-set-id";
import { api } from "~/utils/api";
import { buildRunPlans, type RunPlan, type RunPlanLastRun } from "./run-plans";

export type UseRunPlansResult = {
  plans: RunPlan[];
  isLoading: boolean;
  /**
   * False while the project holds no run plan at all: no suite, no external
   * run set and no one-off run. The table shows its first-use empty state
   * from this, not from whether a plan has ever run.
   */
  hasAnyPlans: boolean;
};

export function useRunPlans({ period }: { period: Period }): UseRunPlansResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();

  // Both kinds: a folder reads as a run plan of its own in the Test Runs
  // list, next to the hand-assembled custom plans.
  const { data: suites, isLoading: isSuitesLoading } =
    api.suites.getAll.useQuery(
      { projectId, kinds: ["custom", "folder"] },
      { enabled: !!project },
    );

  const { data: suiteSummaries } = api.suites.getSummaries.useQuery(
    { projectId, startDate, endDate },
    { enabled: !!project },
  );

  const { data: externalSets, isLoading: isExternalLoading } =
    api.scenarios.getExternalSetSummaries.useQuery(
      { projectId, startDate, endDate },
      { enabled: !!project },
    );

  // The internal set has no summary query of its own, so its newest batch is
  // read straight from the batch history. One batch is all a row shows.
  const { data: oneOffHistory, isLoading: isOneOffLoading } =
    api.scenarios.getScenarioSetBatchHistory.useQuery(
      {
        projectId,
        scenarioSetId: getOnPlatformSetId(projectId),
        limit: 1,
        startDate,
        endDate,
      },
      { enabled: !!project },
    );

  const oneOffLastRun = useMemo<RunPlanLastRun | null>(() => {
    const newest = oneOffHistory?.batches[0];
    if (!newest) return null;
    return {
      passedCount: newest.passCount,
      failedCount: newest.failCount,
      settledCount: newest.settledCount,
      lastRunTimestamp: newest.lastRunAt,
    };
  }, [oneOffHistory]);

  const plans = useMemo(
    () =>
      buildRunPlans({
        projectId,
        suites: suites ?? [],
        suiteSummaries: suiteSummaries ?? {},
        externalSets: externalSets ?? [],
        oneOffLastRun,
      }),
    [projectId, suites, suiteSummaries, externalSets, oneOffLastRun],
  );

  const hasAnyPlans =
    (suites?.length ?? 0) > 0 ||
    (externalSets?.length ?? 0) > 0 ||
    oneOffLastRun !== null;

  return {
    plans,
    isLoading: isSuitesLoading || isExternalLoading || isOneOffLoading,
    hasAnyPlans,
  };
}
