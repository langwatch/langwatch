/**
 * Unified simulations page — the primary view for all simulation runs.
 *
 * Rendered by multiple Next.js page files under /simulations/:
 *   /simulations                              (all runs view)
 *   /simulations/run-plans/:suiteSlug         (suite detail)
 *   /simulations/run-plans/:suiteSlug/:batchId (suite detail, scroll to batch)
 *   /simulations/:externalSetSlug             (external set detail)
 *   /simulations/:externalSetSlug/:batchId    (external set, scroll to batch)
 *
 * Layout: sidebar (search, +New Run Plan, All Runs, suite list) + main panel.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { subDays } from "date-fns";
import { Plus } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useRouter } from "~/utils/compat/next-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PeriodSelector, usePeriodSelector, type Period } from "~/components/PeriodSelector";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { RunHistoryPanel } from "~/components/suites/RunHistoryPanel";
import { SuiteArchiveDialog } from "~/components/suites/SuiteArchiveDialog";
import { SuiteContextMenu } from "~/components/suites/SuiteContextMenu";
import {
  SuiteDetailPanel,
  SuiteEmptyState,
} from "~/components/suites/SuiteDetailPanel";
import { ExternalSetDetailPanel } from "~/components/suites/ExternalSetDetailPanel";
import { SuiteSidebar } from "~/components/suites/SuiteSidebar";
import type { SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import { useRunSuite } from "~/components/suites/useRunSuite";
import { SuiteRunConfirmationDialog } from "~/components/suites/SuiteRunConfirmationDialog";
import {
  ALL_RUNS_ID,
  extractExternalSetId,
  isExternalSetSelection,
  useSuiteRouting,
} from "~/components/suites/useSuiteRouting";
import { toaster } from "~/components/ui/toaster";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { useDrawer } from "~/hooks/useDrawer";
import { NowProvider } from "./NowProvider";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export default function SimulationsPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, setFlowCallbacks } = useDrawer();
  const utils = api.useContext();
  const { selectedSuiteSlug, navigateToSuite, highlightBatchId } = useSuiteRouting();

  // Auto-open run detail drawer when redirected from old individual run URL
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    const openRunId = router.query.openRun;
    if (typeof openRunId === "string" && openRunId) {
      openDrawer("scenarioRunDetail", {
        urlParams: { scenarioRunId: openRunId },
      });
      // Remove the query param to avoid re-opening on navigation
      const { openRun: _, ...restQuery } = router.query;
      void router.replace({ pathname: router.pathname, query: restQuery }, undefined, { shallow: true });
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read pending batch from URL query param (set by "Save and Run" redirect)
  const [urlPendingBatchId, setUrlPendingBatchId] = useState<string | null>(null);
  useEffect(() => {
    if (!router.isReady) return;
    const pendingBatch = router.query.pendingBatch;
    if (typeof pendingBatch === "string" && pendingBatch) {
      setUrlPendingBatchId(pendingBatch);
      // Remove the query param to keep URL clean
      const { pendingBatch: _, ...restQuery } = router.query;
      void router.replace({ pathname: router.pathname, query: restQuery }, undefined, { shallow: true });
    }
  }, [router.isReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const { period, setPeriod } = usePeriodSelector(30);

  // State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    suiteId: string;
  } | null>(null);
  const [archiveConfirmId, setArchiveConfirmId] = useState<string | null>(null);

  // Queries
  const {
    data: suites,
    isLoading,
    error,
  } = api.suites.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const { data: externalSets, isLoading: isExternalSetsLoading } = api.scenarios.getExternalSetSummaries.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: !!project, refetchInterval: 15000 },
  );

  const { data: suiteSummariesData } = api.suites.getSummaries.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: !!project, refetchInterval: 30_000 },
  );

  // Connect the sidebar-level query to SSE events so new runs appear without
  // waiting for the 30s poll interval. Without this, the SSE listener only
  // lives inside RunHistoryPanel, leaving the sidebar query unreachable.
  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      void utils.suites.getSummaries.invalidate();
      void utils.scenarios.getExternalSetSummaries.invalidate();
    },
    enabled: !!project?.id,
    debounceMs: 500,
  });

  const runSummaries = useMemo(() => {
    if (!suiteSummariesData) return undefined;
    return new Map<string, SuiteRunSummary>(Object.entries(suiteSummariesData));
  }, [suiteSummariesData]);

  // Build suiteId -> suite name map for AllRuns view
  const suiteNameMap = useMemo(() => {
    const map = new Map<string, string>();
    if (suites) {
      for (const suite of suites) {
        map.set(suite.id, suite.name);
      }
    }
    return map;
  }, [suites]);

  const selectedSuite = useMemo(() => {
    if (!selectedSuiteSlug || selectedSuiteSlug === ALL_RUNS_ID) return null;
    if (isExternalSetSelection(selectedSuiteSlug)) return null;
    return suites?.find((s) => s.slug === selectedSuiteSlug) ?? null;
  }, [selectedSuiteSlug, suites]);

  const selectedExternalSetId = useMemo(() => {
    if (!selectedSuiteSlug || !isExternalSetSelection(selectedSuiteSlug))
      return null;
    return extractExternalSetId(selectedSuiteSlug);
  }, [selectedSuiteSlug]);

  // Auto-expand period when selected item's last run is outside current range
  useEffect(() => {
    if (!selectedSuiteSlug || selectedSuiteSlug === ALL_RUNS_ID) return;

    let lastRunTs: number | null = null;
    if (isExternalSetSelection(selectedSuiteSlug) && externalSets) {
      const setId = extractExternalSetId(selectedSuiteSlug);
      lastRunTs = externalSets.find((s) => s.scenarioSetId === setId)?.lastRunTimestamp ?? null;
    } else if (selectedSuite && runSummaries) {
      lastRunTs = runSummaries.get(selectedSuite.id)?.lastRunTimestamp ?? null;
    }

    if (lastRunTs && lastRunTs < period.startDate.getTime()) {
      const daysAgo = Math.ceil((Date.now() - lastRunTs) / 86400000);
      const newDays = daysAgo <= 30 ? 30 : daysAgo <= 90 ? 90 : 365;
      setPeriod(subDays(new Date(), newDays), new Date());
    }
  }, [selectedSuiteSlug]); // eslint-disable-line react-hooks/exhaustive-deps

  const archiveTargetSuite = archiveConfirmId
    ? suites?.find((s) => s.id === archiveConfirmId)
    : null;

  // Mutations
  const archiveMutation = api.suites.archive.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
      const archivedSuite = suites?.find((s) => s.id === archiveConfirmId);
      if (archivedSuite && archivedSuite.slug === selectedSuiteSlug) {
        navigateToSuite(ALL_RUNS_ID);
      }
      setArchiveConfirmId(null);
      toaster.create({
        title: "Run plan archived",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to archive run plan",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const duplicateMutation = api.suites.duplicate.useMutation({
    onSuccess: (data) => {
      void utils.suites.getAll.invalidate();
      navigateToSuite(data.slug);
      toaster.create({
        title: "Run plan duplicated",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to duplicate run plan",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const { requestRun, isPending: isRunPending, pendingBatchRunId, dialogProps: runDialogProps } = useRunSuite({
    onRunScheduled: (suiteId) => {
      void utils.suites.getSummaries.invalidate();
      // Navigate to the suite so the user sees the run starting
      const suite = suites?.find((s) => s.id === suiteId);
      if (suite && selectedSuiteSlug !== suite.slug) {
        navigateToSuite(suite.slug);
      }
    },
  });

  // Handlers
  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      navigateToSuite(suite.slug);
    },
    [navigateToSuite],
  );

  const handleRunRequested = useCallback(
    (suite: SimulationSuite) => {
      navigateToSuite(suite.slug);
      requestRun(suite);
    },
    [navigateToSuite, requestRun],
  );

  const handleNewSuite = useCallback(() => {
    setFlowCallbacks("suiteEditor", {
      onSaved: handleSuiteSaved,
      onRunRequested: handleRunRequested,
    });
    openDrawer("suiteEditor");
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved, handleRunRequested]);

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      setFlowCallbacks("suiteEditor", {
        onSaved: handleSuiteSaved,
        onRunRequested: handleRunRequested,
      });
      openDrawer("suiteEditor", { urlParams: { suiteId } });
    },
    [openDrawer, setFlowCallbacks, handleSuiteSaved, handleRunRequested],
  );

  const handleRunSuite = useCallback(
    (suiteId: string) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (!suite) return;
      requestRun(suite);
    },
    [suites, requestRun],
  );

  const handleDuplicateSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
      duplicateMutation.mutate({ projectId: project.id, id: suiteId });
    },
    [project, duplicateMutation],
  );

  const handleArchiveSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
      setArchiveConfirmId(suiteId);
    },
    [project],
  );

  const confirmArchive = useCallback(() => {
    if (!project || !archiveConfirmId) return;
    archiveMutation.mutate({ projectId: project.id, id: archiveConfirmId });
  }, [project, archiveConfirmId, archiveMutation]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, suiteId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, suiteId });
    },
    [],
  );

  return (
    <NowProvider>
    <DashboardLayout>
      <VStack width="full" height="full" gap={0}>
        {/* Top row: heading + buttons */}
        <PageLayout.Header withBorder={false}>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Simulations</PageLayout.Heading>
            <HStack>
              <PeriodSelector period={period} setPeriod={setPeriod} />
              <PageLayout.HeaderButton onClick={handleNewSuite}>
                <Plus size={16} /> New Run Plan
              </PageLayout.HeaderButton>
            </HStack>
          </HStack>
        </PageLayout.Header>

        {/* Second row: sidebar + content box */}
        <HStack flex={1} width="full" gap={0} overflow="hidden" minHeight={0}>
          {/* Sidebar */}
          <SuiteSidebar
            projectSlug={project?.slug ?? ""}
            suites={suites ?? []}
            selectedSuiteSlug={selectedSuiteSlug}
            runSummaries={runSummaries}
            externalSets={externalSets ?? []}
            onSelectSuite={navigateToSuite}
            onRunSuite={handleRunSuite}
            onContextMenu={handleContextMenu}
            isLoading={isLoading || isExternalSetsLoading}
          />

          {/* Content box */}
          <Box
            flex={1}
            height="full"
            minWidth={0}
            paddingBottom={3}
            paddingRight={4}
          >
            <Box
              height="full"
              width="full"
              borderRadius="lg"
              boxShadow="0 4px 6px -1px rgba(0,0,0,0.1), 0 2px 4px -2px rgba(0,0,0,0.1), 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -4px rgba(0,0,0,0.1)"
              border="1px solid"
              borderColor="border.muted"
              background="bg.panel"
              overflow="auto"
            >
              <MainPanel
                error={error ?? null}
                selectedSuiteSlug={selectedSuiteSlug}
                selectedSuite={selectedSuite}
                selectedExternalSetId={selectedExternalSetId}
                isLoading={isLoading}
                onNewSuite={handleNewSuite}
                onEditSuite={handleEditSuite}
                onRunSuite={handleRunSuite}
                isRunning={isRunPending}
                pendingBatchRunId={pendingBatchRunId ?? urlPendingBatchId}
                period={period}
                suiteNameMap={suiteNameMap}
                highlightBatchId={highlightBatchId}
              />
            </Box>
          </Box>
        </HStack>
      </VStack>

      {/* Context menu */}
      {contextMenu && (
        <SuiteContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={() => handleEditSuite(contextMenu.suiteId)}
          onDuplicate={() => handleDuplicateSuite(contextMenu.suiteId)}
          onArchive={() => handleArchiveSuite(contextMenu.suiteId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Archive confirmation dialog */}
      <SuiteArchiveDialog
        open={!!archiveConfirmId}
        onClose={() => setArchiveConfirmId(null)}
        onConfirm={confirmArchive}
        suiteName={archiveTargetSuite?.name ?? ""}
        isLoading={archiveMutation.isPending}
      />

      {/* Run confirmation dialog */}
      <SuiteRunConfirmationDialog {...runDialogProps} />

    </DashboardLayout>
    </NowProvider>
  );
}

function MainPanel({
  error,
  selectedSuiteSlug,
  selectedSuite,
  selectedExternalSetId,
  isLoading,
  onNewSuite,
  onEditSuite,
  onRunSuite,
  isRunning,
  pendingBatchRunId,
  period,
  suiteNameMap,
  highlightBatchId,
}: {
  error: { message: string } | null;
  selectedSuiteSlug: string | typeof ALL_RUNS_ID | null;
  selectedSuite: SimulationSuite | null;
  selectedExternalSetId: string | null;
  isLoading: boolean;
  onNewSuite: () => void;
  onEditSuite: (id: string) => void;
  onRunSuite: (id: string) => void;
  isRunning: boolean;
  pendingBatchRunId: string | null;
  period: Period;
  suiteNameMap: Map<string, string>;
  highlightBatchId: string | null;
}) {
  if (error) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="red.500">Error loading simulations</Text>
        <Text fontSize="sm" color="fg.muted">
          {error.message}
        </Text>
      </VStack>
    );
  }

  if (selectedSuiteSlug === null) {
    return null;
  }

  if (selectedExternalSetId) {
    return <ExternalSetDetailPanel scenarioSetId={selectedExternalSetId} period={period} highlightBatchId={highlightBatchId} />;
  }

  if (selectedSuiteSlug === ALL_RUNS_ID) {
    return <RunHistoryPanel period={period} suiteNameMap={suiteNameMap} pendingBatchRunId={pendingBatchRunId} highlightBatchId={highlightBatchId} />;
  }

  if (selectedSuite) {
    return (
      <SuiteDetailPanel
        suite={selectedSuite}
        onEdit={() => onEditSuite(selectedSuite.id)}
        onRun={() => onRunSuite(selectedSuite.id)}
        isRunning={isRunning}
        pendingBatchRunId={pendingBatchRunId}
        period={period}
        highlightBatchId={highlightBatchId}
      />
    );
  }

  // Suite slug specified but suite object not yet loaded — wait for suites.getAll
  if (isLoading) {
    return null;
  }

  return <SuiteEmptyState onNewSuite={onNewSuite} />;
}
