/**
 * One run plan: its runs in a rail on the left, the results of the selected
 * run filling the rest of the page.
 *
 * The results read as a table by default. The grid is the classic wall of
 * live conversation cards, the same component the v1 page draws.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import {
  Box,
  Button,
  EmptyState,
  HStack,
  Skeleton,
  VStack,
} from "@chakra-ui/react";
import { FlaskConical, RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import type {
  Period,
  PeriodMode,
  RelativePresetKey,
} from "~/components/PeriodSelector";
import {
  computeBatchRunSummary,
  computeIterationMap,
  groupRunsByBatchId,
} from "~/components/suites/run-history-transforms";
import { ScenarioRunContent } from "~/components/suites/ScenarioRunContent";
import { ScenarioRunExportDialog } from "~/components/suites/ScenarioRunExportDialog";
import { useCancelScenarioRun } from "~/components/suites/useCancelScenarioRun";
import { useExportScenarioRuns } from "~/components/suites/useExportScenarioRuns";
import { useRunHistoryPagination } from "~/components/suites/useRunHistoryPagination";
import { toaster } from "~/components/ui/toaster";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useCan } from "~/hooks/useCan";
import { useDrawer } from "~/hooks/useDrawer";
import { useNow } from "~/hooks/useNow";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { isOnPlatformSet } from "~/server/scenarios/internal-set-id";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import { isSuiteSetId } from "~/server/suites/suite-set-id";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { formatTimeAgoCompact } from "~/utils/formatTimeAgo";
import { ContentColumn } from "../shared/ContentColumn";
import { useAgentTestingStore } from "../useAgentTestingStore";
import { RunPlanDetailHeader } from "./RunPlanDetailHeader";
import { RunResultsTable } from "./RunResultsTable";
import { RunSummaryLine } from "./RunSummaryLine";
import { RUNS_SIDEBAR_WIDTH, RunsSidebar } from "./RunsSidebar";
import {
  batchNote,
  oneOffRunTitle,
  type RunPlan,
  runOrdinal,
} from "./run-plans";

const DAY_MS = 86_400_000;

export type RunPlanDetailProps = {
  plan: RunPlan;
  batchRunId: string | null;
  onSelectRun: (batchRunId: string) => void;
  onBack: () => void;
  onEditPlan: (suiteId: string) => void;
  period: Period;
  periodMode: PeriodMode;
  setPeriod: (startDate: Date, endDate: Date) => void;
  setRelativePeriod: (key: RelativePresetKey) => void;
  /** While the live stream is up the fallback polling stands down. */
  sseConnected: boolean;
};

/** The next window to offer when nothing ran inside the one on screen. */
function nextWiderWindow(period: Period): {
  key: RelativePresetKey;
  label: string;
} {
  const days = Math.round(
    (period.endDate.getTime() - period.startDate.getTime()) / DAY_MS,
  );
  if (days < 90) return { key: "90d", label: "Show the last 90 days" };
  return { key: "1y", label: "Show the last year" };
}

export function RunPlanDetail({
  plan,
  batchRunId,
  onSelectRun,
  onBack,
  onEditPlan,
  period,
  periodMode,
  setPeriod,
  setRelativePeriod,
  sseConnected,
}: RunPlanDetailProps) {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const router = useRouter();
  const now = useNow();
  const { openDrawer } = useDrawer();
  const { can } = useCan();
  const targetNameMap = useTargetNameMap();

  const viewMode = useAgentTestingStore((state) => state.viewMode);
  const setViewMode = useAgentTestingStore((state) => state.setViewMode);
  const syncToUrl = useAgentTestingStore((state) => state.syncToUrl);
  const pendingBatchRunId = useAgentTestingStore(
    (state) => state.pendingBatchRunId,
  );
  const cancellingJobId = useAgentTestingStore(
    (state) => state.cancellingJobId,
  );
  const setCancellingJobId = useAgentTestingStore(
    (state) => state.setCancellingJobId,
  );

  const startDateMs = period.startDate.getTime();
  const endDateMs = period.endDate.getTime();

  const { allRuns, hasMore, loadMore, isLoading, error, refetch } =
    useRunHistoryPagination({
      scenarioSetId: plan.scenarioSetId,
      startDateMs,
      sseConnected,
    });

  // The run number counts the runs of the window, so the newest run of the
  // window carries the count itself.
  const { data: batchCount } =
    api.scenarios.getScenarioSetBatchRunCount.useQuery(
      {
        projectId,
        scenarioSetId: plan.scenarioSetId,
        startDate: startDateMs,
        endDate: endDateMs,
      },
      { enabled: !!project },
    );

  const batchRuns = useMemo(
    () => groupRunsByBatchId({ runs: allRuns }),
    [allRuns],
  );

  // The address may hold no run yet. The newest run of the plan is what the
  // page opens on, without pushing an address nobody asked for.
  const selectedBatch = useMemo(() => {
    if (batchRunId) {
      return batchRuns.find((batch) => batch.batchRunId === batchRunId) ?? null;
    }
    return batchRuns[0] ?? null;
  }, [batchRuns, batchRunId]);

  const selectedSummary = useMemo(
    () =>
      selectedBatch
        ? computeBatchRunSummary({ batchRun: selectedBatch })
        : null,
    [selectedBatch],
  );

  const iterationMap = useMemo(
    () =>
      computeIterationMap({ scenarioRuns: selectedBatch?.scenarioRuns ?? [] }),
    [selectedBatch],
  );

  const resolveTargetName = useCallback(
    (scenarioRun: ScenarioRunData): string | null => {
      const refId = scenarioRun.metadata?.langwatch?.targetReferenceId;
      if (!refId) return null;
      return targetNameMap.get(refId) ?? refId;
    },
    [targetNameMap],
  );

  const {
    isDialogOpen: isExportDialogOpen,
    openExportDialog,
    closeExportDialog,
    startExport,
    isExporting,
  } = useExportScenarioRuns({
    projectId: project?.id,
    scenarioSetId: plan.scenarioSetId,
    startDate: startDateMs,
    endDate: endDateMs,
  });

  const { cancelJob, cancelBatchRun, isCancellingBatch } = useCancelScenarioRun(
    {
      onCancelJobSuccess: () => {
        setCancellingJobId(null);
        void refetch();
        toaster.create({ title: "Cancellation requested", type: "info" });
      },
      onCancelJobError: (cancelError) => {
        setCancellingJobId(null);
        void refetch();
        showErrorToast({
          error: cancelError,
          fallbackTitle: "Couldn't cancel job",
        });
      },
      onCancelBatchSuccess: () => {
        void refetch();
        toaster.create({ title: "Jobs cancelled", type: "success" });
      },
      onCancelBatchError: (cancelError) =>
        showErrorToast({
          error: cancelError,
          fallbackTitle: "Couldn't cancel jobs",
        }),
    },
  );

  // Only a set the platform runs can be stopped from here, and only by a
  // person who may manage runs.
  const canStop =
    can("scenarios:manage") &&
    (isOnPlatformSet(plan.scenarioSetId) || isSuiteSetId(plan.scenarioSetId));

  const handleCancelRun = useCallback(
    (scenarioRun: ScenarioRunData) => {
      if (!projectId) return;
      setCancellingJobId(scenarioRun.scenarioRunId);
      cancelJob({
        projectId,
        scenarioSetId: plan.scenarioSetId,
        batchRunId: scenarioRun.batchRunId,
        scenarioRunId: scenarioRun.scenarioRunId,
        scenarioId: scenarioRun.scenarioId,
      });
    },
    [projectId, plan.scenarioSetId, cancelJob, setCancellingJobId],
  );

  const handleCancelAll = useCallback(() => {
    if (!projectId || !selectedBatch) return;
    cancelBatchRun({
      projectId,
      scenarioSetId: plan.scenarioSetId,
      batchRunId: selectedBatch.batchRunId,
    });
  }, [projectId, plan.scenarioSetId, selectedBatch, cancelBatchRun]);

  const handleScenarioRunClick = useCallback(
    (scenarioRun: ScenarioRunData) => {
      openDrawer("scenarioRunDetail", {
        urlParams: {
          variant: "agent-testing",
          scenarioRunId: scenarioRun.scenarioRunId,
          batchRunId: scenarioRun.batchRunId,
          scenarioSetId: plan.scenarioSetId,
        },
      });
    },
    [openDrawer, plan.scenarioSetId],
  );

  const handleEditCase = useCallback(
    (scenarioRun: ScenarioRunData) => {
      openDrawer("scenarioEditor", {
        urlParams: {
          variant: "agent-testing",
          scenarioId: scenarioRun.scenarioId,
        },
      });
    },
    [openDrawer],
  );

  const handleViewModeChange = useCallback(
    (next: typeof viewMode) => {
      setViewMode(next);
      syncToUrl(router);
    },
    [setViewMode, syncToUrl, router],
  );

  const selectedIndex = selectedBatch
    ? batchRuns.findIndex(
        (batch) => batch.batchRunId === selectedBatch.batchRunId,
      )
    : -1;
  const selectedTitle = selectedBatch
    ? ((plan.kind === "one-off"
        ? oneOffRunTitle(selectedBatch.scenarioRuns)
        : null) ??
      `Run #${runOrdinal({
        index: Math.max(selectedIndex, 0),
        totalCount: batchCount?.count ?? null,
        loadedCount: batchRuns.length,
      })}`)
    : null;
  const selectedNote = selectedBatch
    ? batchNote(selectedBatch.scenarioRuns)
    : null;
  const isBatchRunning =
    !!selectedSummary &&
    selectedSummary.inProgressCount + selectedSummary.queuedCount > 0;

  const wider = nextWiderWindow(period);

  return (
    <HStack
      align="stretch"
      gap={0}
      width="full"
      height="full"
      data-testid="agent-testing-run-plan-detail"
    >
      <RunsSidebar
        plan={plan}
        batchRuns={batchRuns}
        totalBatchCount={batchCount?.count ?? null}
        selectedBatchRunId={selectedBatch?.batchRunId ?? null}
        onSelectRun={onSelectRun}
        onBack={onBack}
        hasMore={hasMore}
        onLoadMore={loadMore}
        isLoading={isLoading}
        pendingBatchRunId={pendingBatchRunId}
        period={period}
        periodMode={periodMode}
        setPeriod={setPeriod}
        setRelativePeriod={setRelativePeriod}
      />

      <ContentColumn railWidth={RUNS_SIDEBAR_WIDTH}>
        <RunPlanDetailHeader
          plan={plan}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          onStopAll={canStop && isBatchRunning ? handleCancelAll : undefined}
          isStoppingAll={isCancellingBatch}
          onExport={openExportDialog}
          isExportDisabled={isLoading || isExporting || batchRuns.length === 0}
          onEditPlan={onEditPlan}
        />

        {error ? (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <Box maxWidth="420px" width="100%">
                <HandledErrorAlert
                  error={error}
                  fallbackTitle="Couldn't load runs"
                />
              </Box>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void refetch()}
              >
                <RefreshCw size={14} /> Try again
              </Button>
            </EmptyState.Content>
          </EmptyState.Root>
        ) : isLoading ? (
          <VStack align="stretch" gap={2}>
            <Skeleton height="36px" />
            <Skeleton height="36px" />
            <Skeleton height="36px" />
          </VStack>
        ) : !selectedBatch ? (
          <EmptyState.Root paddingY={12}>
            <EmptyState.Content>
              <EmptyState.Indicator>
                <FlaskConical size={28} />
              </EmptyState.Indicator>
              <EmptyState.Title>No run in this period</EmptyState.Title>
              <EmptyState.Description>
                This run plan has no run inside the selected period.
              </EmptyState.Description>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRelativePeriod(wider.key)}
                data-testid="widen-period-button"
              >
                {wider.label}
              </Button>
            </EmptyState.Content>
          </EmptyState.Root>
        ) : (
          <>
            <RunSummaryLine
              title={selectedTitle ?? ""}
              timeAgo={formatTimeAgoCompact(selectedBatch.timestamp, now)}
              note={selectedNote}
              summary={selectedSummary}
            />

            {viewMode === "grid" ? (
              <ScenarioRunContent
                scenarioRuns={selectedBatch.scenarioRuns}
                viewMode="grid"
                resolveTargetName={resolveTargetName}
                onScenarioRunClick={handleScenarioRunClick}
                iterationMap={iterationMap}
                onCancelRun={canStop ? handleCancelRun : undefined}
                cancellingJobId={cancellingJobId}
              />
            ) : (
              <RunResultsTable
                scenarioRuns={selectedBatch.scenarioRuns}
                resolveTargetName={resolveTargetName}
                iterationMap={iterationMap}
                onScenarioRunClick={handleScenarioRunClick}
                onCancelRun={canStop ? handleCancelRun : undefined}
                cancellingJobId={cancellingJobId}
                onEditCase={
                  can("scenarios:manage") ? handleEditCase : undefined
                }
              />
            )}
          </>
        )}
      </ContentColumn>

      <ScenarioRunExportDialog
        isOpen={isExportDialogOpen}
        onClose={closeExportDialog}
        onExport={startExport}
        runCount={allRuns.length}
        hasFiltersApplied={false}
      />
    </HStack>
  );
}
