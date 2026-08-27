/**
 * The run plans of the open project, read from the two places a plan lives:
 * the test suites, and the external sets a code run writes into.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { buildRunPlans, type RunPlan } from "./run-plans";

export type UseRunPlansResult = {
  plans: RunPlan[];
  isLoading: boolean;
  /**
   * False while the project holds no run plan at all: no suite and no external
   * run set. The table shows its first-use empty state from this, not from
   * whether a plan has ever run.
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

  const plans = useMemo(
    () =>
      buildRunPlans({
        suites: suites ?? [],
        suiteSummaries: suiteSummaries ?? {},
        externalSets: externalSets ?? [],
      }),
    [suites, suiteSummaries, externalSets],
  );

  const hasAnyPlans =
    (suites?.length ?? 0) > 0 || (externalSets?.length ?? 0) > 0;

  return {
    plans,
    isLoading: isSuitesLoading || isExternalLoading,
    hasAnyPlans,
  };
}
