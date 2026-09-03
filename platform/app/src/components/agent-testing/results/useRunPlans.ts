/**
 * The run plans of the open project, read from the two places a plan lives:
 * the stored run plans, and the external sets a code run writes into.
 *
 * A test suite is a group of scenarios, so it is never a row of the Test Runs
 * list. Its rows are read all the same, because a plan whose scope names test
 * suites reads them by name.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useMemo } from "react";
import type { Period } from "~/components/PeriodSelector";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { buildRunPlans, type RunPlan, toRunPlanSuites } from "./run-plans";

export type UseRunPlansResult = {
  plans: RunPlan[];
  isLoading: boolean;
  /**
   * False while the project holds no run plan at all: no stored plan and no
   * external run set. The table shows its first-use empty state from this, not
   * from whether a plan has ever run.
   */
  hasAnyPlans: boolean;
};

export function useRunPlans({ period }: { period: Period }): UseRunPlansResult {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const startDate = period.startDate.getTime();
  const endDate = period.endDate.getTime();

  // Both kinds: the run plan rows are the plans, and the test suites are read only
  // for the names a plan's scope may point at.
  const { data: suites, isLoading: isSuitesLoading } =
    api.suites.getAll.useQuery(
      { projectId, kinds: ["run_plan", "test_suite"] },
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

  const storedPlans = useMemo(() => toRunPlanSuites(suites ?? []), [suites]);

  const plans = useMemo(
    () =>
      buildRunPlans({
        plans: storedPlans,
        suiteNames: new Map(
          (suites ?? []).map((suite) => [suite.id, suite.name]),
        ),
        suiteSummaries: suiteSummaries ?? {},
        externalSets: externalSets ?? [],
      }),
    [storedPlans, suites, suiteSummaries, externalSets],
  );

  const hasAnyPlans = storedPlans.length > 0 || (externalSets?.length ?? 0) > 0;

  return {
    plans,
    isLoading: isSuitesLoading || isExternalLoading,
    hasAnyPlans,
  };
}
