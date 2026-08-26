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

import { Skeleton, VStack } from "@chakra-ui/react";
import { useCallback, useEffect } from "react";
import { usePeriodSelector } from "~/components/PeriodSelector";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { PLAN_EDITOR_DRAWER } from "../plan/usePlanEditor";
import { AgentTestingTabLayout } from "../shared/TabLayout";
import { useNewRunPlanFlow } from "../useAgentTestingPageFlows";
import { useAgentTestingRouting } from "../useAgentTestingRouting";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { RunPlanDetail } from "./RunPlanDetail";
import { RunPlansTable } from "./RunPlansTable";
import { planScopeNote, type RunPlan, resolveRunPlan } from "./run-plans";
import { useRunPlans } from "./useRunPlans";
import { useWidenWindowForPlan } from "./useWidenWindowForPlan";

export type ResultsTabProps = {
  /** While the live stream is up the fallback polling stands down. */
  isSseConnected: boolean;
};

/**
 * Names the open run plan as the page title, and hands the title back when
 * the plan is left.
 */
function usePlanAsPageTitle(plan: RunPlan | null) {
  const setOpenPlanTitle = useAgentTestingStore(
    (state) => state.setOpenPlanTitle,
  );
  const name = plan?.name ?? null;
  const note = plan ? planScopeNote(plan.kind) : null;

  useEffect(() => {
    if (name === null || note === null) {
      setOpenPlanTitle(null);
      return;
    }
    setOpenPlanTitle({ name, note });
    return () => setOpenPlanTitle(null);
  }, [name, note, setOpenPlanTitle]);
}

export function ResultsTab({ isSseConnected }: ResultsTabProps) {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const { planSlug, batchRunId, isReady, selectPlan, selectRun } =
    useAgentTestingRouting();
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);
  const { plans, isLoading, hasAnyPlans } = useRunPlans({ period });
  const handleNewRunPlan = useNewRunPlanFlow(selectPlan);

  const selectedPlan = planSlug
    ? resolveRunPlan({ plans, planSlug, projectId: project?.id ?? "" })
    : null;

  usePlanAsPageTitle(selectedPlan);

  useWidenWindowForPlan({
    planSlug,
    lastRunTimestamp: selectedPlan?.lastRun?.lastRunTimestamp ?? null,
    period,
    setPeriod,
  });

  const handleEditPlan = useCallback(
    (suiteId: string) => {
      openDrawer(PLAN_EDITOR_DRAWER, { urlParams: { suiteId } });
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

  // When the URL names a plan, we must not fall through to the plans list —
  // even for a frame. A false render on `!selectedPlan` while the queries are
  // still on their way reads as "plan not found" for a split second before the
  // real detail arrives. The empty branch is reserved for `!isLoading && !data`.
  const isResolvingPlan = !!planSlug && !selectedPlan && isLoading;

  // The plan detail already has a rail (RunsSidebar) baked in. The list view
  // has none, so it takes an invisible rail spacer of the same width so the
  // content column lines up with the Test cases table.
  if (planSlug && selectedPlan) {
    return (
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
        isSseConnected={isSseConnected}
      />
    );
  }

  return (
    <AgentTestingTabLayout data-testid="agent-testing-results-tab">
      {isResolvingPlan ? (
        <VStack
          align="stretch"
          gap={2}
          padding={6}
          flex={1}
          minWidth={0}
          data-testid="agent-testing-run-plan-loading"
        >
          <Skeleton height="44px" />
          <Skeleton height="44px" />
          <Skeleton height="44px" />
        </VStack>
      ) : (
        <RunPlansTable
          plans={plans}
          isLoading={isLoading}
          hasAnyPlans={hasAnyPlans}
          period={period}
          periodMode={mode}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          onSelectPlan={selectPlan}
          onEditPlan={handleEditPlan}
          onNewRunPlan={handleNewRunPlan}
        />
      )}
    </AgentTestingTabLayout>
  );
}
