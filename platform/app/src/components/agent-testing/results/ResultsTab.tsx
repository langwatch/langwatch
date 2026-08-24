/**
 * The Results tab: the list of run plans, and inside one plan its runs and
 * the results of the selected run.
 *
 * The whole tab reads one window. When the last run of the plan being opened
 * is older than that window, the window widens until the run is inside it, so
 * a plan is never opened on an empty page while its runs exist.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Skeleton, VStack } from "@chakra-ui/react";
import { subDays } from "date-fns";
import { useCallback, useEffect } from "react";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useAgentTestingRouting } from "../useAgentTestingRouting";
import { RunPlanDetail } from "./RunPlanDetail";
import { RunPlansTable } from "./RunPlansTable";
import { resolveRunPlan, widenedWindowDays } from "./run-plans";
import { useRunPlans } from "./useRunPlans";

export type ResultsTabProps = {
  /** While the live stream is up the fallback polling stands down. */
  sseConnected: boolean;
};

export function ResultsTab({ sseConnected }: ResultsTabProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const { planSlug, batchRunId, isReady, selectPlan, selectRun } =
    useAgentTestingRouting();
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);
  const { plans, isLoading, hasAnyRuns } = useRunPlans({ period });

  const selectedPlan = planSlug
    ? resolveRunPlan({ plans, planSlug, projectId: project?.id ?? "" })
    : null;

  // Opening a plan whose last run fell out of the window widens the window,
  // the same rule the v1 page keeps.
  const lastRunTimestamp = selectedPlan?.lastRun?.lastRunTimestamp ?? null;
  useEffect(() => {
    if (!planSlug || !lastRunTimestamp) return;
    if (lastRunTimestamp >= period.startDate.getTime()) return;
    const now = Date.now();
    setPeriod(
      subDays(new Date(now), widenedWindowDays(lastRunTimestamp, now)),
      new Date(now),
    );
  }, [planSlug, lastRunTimestamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleEditPlan = useCallback(
    (suiteId: string) => {
      openDrawer("suiteEditor", { urlParams: { suiteId } });
    },
    [openDrawer],
  );

  const handleBack = useCallback(() => selectPlan(null), [selectPlan]);

  if (!isReady) {
    return (
      <VStack
        align="stretch"
        gap={2}
        padding={6}
        data-testid="agent-testing-results-tab"
      >
        <Skeleton height="44px" />
        <Skeleton height="44px" />
      </VStack>
    );
  }

  return (
    <Box width="full" height="full" data-testid="agent-testing-results-tab">
      {planSlug && selectedPlan ? (
        <RunPlanDetail
          plan={selectedPlan}
          batchRunId={batchRunId}
          onSelectRun={selectRun}
          onBack={handleBack}
          onEditPlan={handleEditPlan}
          period={period}
          periodMode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          sseConnected={sseConnected}
        />
      ) : (
        <RunPlansTable
          plans={plans}
          isLoading={isLoading || (!!planSlug && !selectedPlan)}
          hasAnyRuns={hasAnyRuns}
          period={period}
          periodMode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          onSelectPlan={selectPlan}
          onEditPlan={handleEditPlan}
        />
      )}
    </Box>
  );
}
