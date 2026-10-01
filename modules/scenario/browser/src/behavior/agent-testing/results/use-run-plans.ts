/**
 * The run plans of the open project, read from the two places a plan lives: the stored
 * run plans, and the external sets a code run writes into.
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { useMemo } from "react";

import type { Period } from "../../../ui/elements/analytics/period-selector.tsx";
import { api } from "../../scenario-api.ts";
import { useExternalSetSummaries, useSuiteSummaries } from "../../suites/use-set-summaries.ts";
import { useSuites } from "../../suites/use-suites.ts";
import { buildRunPlans, type RunPlan, toRunPlanSuites } from "./run-plans.ts";

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
  const startDate = period.startDate.epochMilliseconds;
  const endDate = period.endDate.epochMilliseconds;

  // Both kinds: the run plan rows are the plans, and the test suites are read only
  // for the names a plan's scope may point at.
  const { data: suites, isLoading: isSuitesLoading } = useSuites({
    projectId,
    kinds: ["run_plan", "test_suite"],
  });

  const { data: suiteSummaries } = useSuiteSummaries({ projectId, startDate, endDate });

  const { data: externalSets, isLoading: isExternalLoading } = useExternalSetSummaries({
    projectId,
    startDate,
    endDate,
  });

  const storedPlans = useMemo(() => toRunPlanSuites(suites ?? []), [suites]);

  const plans = useMemo(
    () =>
      buildRunPlans({
        plans: storedPlans,
        suiteNames: new Map((suites ?? []).map((suite) => [suite.id, suite.name])),
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
