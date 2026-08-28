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
import { useOpenRunPlan } from "../run/RunPlanDialogHost";
import { AgentTestingTabLayout } from "../shared/TabLayout";
import { useNewRunPlanFlow } from "../useAgentTestingPageFlows";
import { useAgentTestingRouting } from "../useAgentTestingRouting";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { ResultsList } from "./ResultsList";
import { RunPlanDetail } from "./RunPlanDetail";
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

function TabSkeleton({
  padding = 6,
  rows = 2,
  testId,
  flex,
}: {
  padding?: number;
  rows?: number;
  testId?: string;
  flex?: number;
}) {
  return (
    <VStack
      align="stretch"
      gap={2}
      padding={padding}
      flex={flex}
      minWidth={flex !== undefined ? 0 : undefined}
      data-testid={testId}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height="44px" />
      ))}
    </VStack>
  );
}

/**
 * The tab before the router reports the address. The skeleton stands in for
 * the plans list, which has no rail, so it reserves none either and does not
 * shift when `isReady` flips true.
 */
function ResultsTabPending() {
  return (
    <AgentTestingTabLayout
      reserveRailSpace={false}
      data-testid="agent-testing-results-tab"
    >
      <TabSkeleton flex={1} />
    </AgentTestingTabLayout>
  );
}

export function ResultsTab({ isSseConnected }: ResultsTabProps) {
  const routing = useAgentTestingRouting();
  const {
    planSlug,
    batchRunId,
    isReady,
    selectPlan,
    selectRun,
    selectPlanRun,
  } = routing;
  const { period, mode, setPeriod, setRelativePeriod } = usePeriodSelector(30);
  const { plans, isLoading, hasAnyPlans } = useRunPlans({ period });
  const handleNewRunPlan = useNewRunPlanFlow();
  const openRunPlan = useOpenRunPlan();

  const selectedPlan = planSlug ? resolveRunPlan({ plans, planSlug }) : null;

  usePlanAsPageTitle(selectedPlan);

  useWidenWindowForPlan({
    planSlug,
    lastRunTimestamp: selectedPlan?.lastRun?.lastRunTimestamp ?? null,
    period,
    setPeriod,
  });

  // A run plan is configured in the run dialog, which is the only place a run
  // is configured at all.
  const handleEditPlan = openRunPlan;

  const handleBack = useCallback(() => selectPlan(null), [selectPlan]);

  if (!isReady) return <ResultsTabPending />;

  // The plan detail has a rail (RunsSidebar) baked in. The list view has
  // none, and reserves none: it is the widest table of the page and reads
  // centred on the whole page.
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
    <ResultsListView
      routingState={routing}
      planSlug={planSlug}
      selectedPlan={selectedPlan}
      plans={plans}
      isLoading={isLoading}
      hasAnyPlans={hasAnyPlans}
      period={period}
      periodMode={mode}
      setPeriod={setPeriod}
      setRelativePeriod={setRelativePeriod}
      onSelectPlan={selectPlan}
      onSelectPlanRun={selectPlanRun}
      onEditPlan={handleEditPlan}
      onNewRunPlan={handleNewRunPlan}
      isSseConnected={isSseConnected}
    />
  );
}

type ResultsListViewProps = Omit<
  React.ComponentProps<typeof ResultsList>,
  "isPlansLoading" | "onSelectRun"
> & {
  planSlug: string | null;
  selectedPlan: RunPlan | null;
  isLoading: boolean;
  onSelectPlanRun: (target: { planSlug: string; batchRunId: string }) => void;
};

function ResultsListView({
  planSlug,
  selectedPlan,
  isLoading,
  onSelectPlan,
  onSelectPlanRun,
  ...listProps
}: ResultsListViewProps) {
  // When the URL names a plan, we must not fall through to the plans list —
  // even for a frame. A false render on `!selectedPlan` while the queries are
  // still on their way reads as "plan not found" for a split second before the
  // real detail arrives. The empty branch is reserved for `!isLoading && !data`.
  const isResolvingPlan = !!planSlug && !selectedPlan && isLoading;

  // Opening one run from an opened row lands on that run of its plan, in one
  // address change, so the person sees the run they chose and not the plan's
  // newest one.
  const handleSelectRun = useCallback(
    (runPlanSlug: string, batchRunId: string) =>
      onSelectPlanRun({ planSlug: runPlanSlug, batchRunId }),
    [onSelectPlanRun],
  );

  return (
    <AgentTestingTabLayout
      reserveRailSpace={false}
      data-testid="agent-testing-results-tab"
    >
      {isResolvingPlan ? (
        <TabSkeleton
          rows={3}
          flex={1}
          testId="agent-testing-run-plan-loading"
        />
      ) : (
        <ResultsList
          {...listProps}
          isPlansLoading={isLoading}
          onSelectPlan={onSelectPlan}
          onSelectRun={handleSelectRun}
        />
      )}
    </AgentTestingTabLayout>
  );
}
