/**
 * Suites page - Create, manage, and run simulation suites.
 *
 * Uses a query parameter `?suite=<slug>` to select a suite:
 *   /simulations/suites              (all runs view)
 *   /simulations/suites?suite=my-slug (specific suite view)
 *
 * Layout: sidebar (search, +New Suite, All Runs, suite list) + main panel.
 */

import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { computeSuiteRunSummaries } from "~/components/suites/run-history-transforms";
import { useRunSuite } from "~/components/suites/useRunSuite";
import { SuiteRunConfirmationDialog } from "~/components/suites/SuiteRunConfirmationDialog";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  ALL_RUNS_ID,
  extractExternalSetId,
  isExternalSetSelection,
  useSuiteRouting,
} from "~/components/suites/useSuiteRouting";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const SKELETON_PLACEHOLDER_COUNT = 6;

function SuitesPageContent() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, setFlowCallbacks } = useDrawer();
  const utils = api.useContext();
  const { selectedSuiteSlug, navigateToSuite } = useSuiteRouting();
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

  const { data: externalSets } = api.scenarios.getExternalSetSummaries.useQuery(
    {
      projectId: project?.id ?? "",
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: !!project, refetchInterval: 15000 },
  );

  const [suiteRunSinceTimestamp, setSuiteRunSinceTimestamp] = useState<number | undefined>(undefined);
  const [cachedRunData, setCachedRunData] = useState<{
    runs: ScenarioRunData[];
    scenarioSetIds: Record<string, string>;
  } | undefined>(undefined);

  // Reset sinceTimestamp when period changes
  const periodKeyRef = useRef(period.startDate.getTime());
  useEffect(() => {
    const key = period.startDate.getTime();
    if (key !== periodKeyRef.current) {
      periodKeyRef.current = key;
      setSuiteRunSinceTimestamp(undefined);
      setCachedRunData(undefined);
    }
  }, [period]);

  const { data: allRunDataRaw } = api.scenarios.getSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      limit: 100,
      startDate: period.startDate.getTime(),
      sinceTimestamp: suiteRunSinceTimestamp,
    },
    { enabled: !!project, refetchInterval: 30_000 },
  );

  // Connect the sidebar-level query to SSE events so new runs appear without
  // waiting for the 30s poll interval. Without this, the SSE listener only
  // lives inside RunHistoryPanel, leaving the sidebar query unreachable.
  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch: () => {
      setSuiteRunSinceTimestamp(undefined);
      void utils.scenarios.getSuiteRunData.invalidate();
    },
    enabled: !!project?.id,
    debounceMs: 500,
  });

  // Update cached data only when server reports changes
  useEffect(() => {
    if (!allRunDataRaw) return;
    if (allRunDataRaw.changed) {
      setCachedRunData({
        runs: allRunDataRaw.runs,
        scenarioSetIds: allRunDataRaw.scenarioSetIds,
      });
      setSuiteRunSinceTimestamp(allRunDataRaw.lastUpdatedAt);
    }
  }, [allRunDataRaw]);

  const runSummaries = useMemo(() => {
    if (!cachedRunData) return undefined;
    return computeSuiteRunSummaries({
      runs: cachedRunData.runs,
      scenarioSetIds: cachedRunData.scenarioSetIds,
    });
  }, [cachedRunData]);

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

  const retryTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    return () => {
      retryTimersRef.current.forEach(clearTimeout);
    };
  }, []);

  const { requestRun, isPending: isRunPending, dialogProps: runDialogProps } = useRunSuite({
    onRunScheduled: () => {
      setSuiteRunSinceTimestamp(undefined);
      void utils.scenarios.getSuiteRunData.invalidate();

      // The queue processor stages commands to Redis and processes them async.
      // Schedule follow-up invalidations to catch ClickHouse data once the
      // event-sourcing pipeline settles, as a safety net alongside SSE.
      retryTimersRef.current.forEach(clearTimeout);
      retryTimersRef.current = [
        setTimeout(() => {
          setSuiteRunSinceTimestamp(undefined);
          void utils.scenarios.getSuiteRunData.invalidate();
        }, 1000),
        setTimeout(() => {
          setSuiteRunSinceTimestamp(undefined);
          void utils.scenarios.getSuiteRunData.invalidate();
        }, 3000),
      ];
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
      navigateToSuite(suite.slug);
      requestRun(suite);
    },
    [suites, navigateToSuite, requestRun],
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
    <DashboardLayout>
      <VStack width="full" height="full" gap={0}>
        {/* Top row: heading + buttons */}
        <PageLayout.Header withBorder={false}>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Run Plans</PageLayout.Heading>
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
          {isLoading ? (
            <VStack
              width="280px"
              flexShrink={0}
              padding={4}
              gap={3}
              align="stretch"
              height="full"
            >
              {Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, index) => (
                <Skeleton
                  key={index}
                  data-testid="suite-sidebar-skeleton"
                  height="61px"
                  width="100%"
                  borderRadius="md"
                />
              ))}
            </VStack>
          ) : (
            <SuiteSidebar
              suites={suites ?? []}
              selectedSuiteSlug={selectedSuiteSlug}
              runSummaries={runSummaries}
              externalSets={externalSets ?? []}
              onSelectSuite={navigateToSuite}
              onRunSuite={handleRunSuite}
              onContextMenu={handleContextMenu}
            />
          )}

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
                period={period}
                suiteNameMap={suiteNameMap}
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
  period,
  suiteNameMap,
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
  period: Period;
  suiteNameMap: Map<string, string>;
}) {
  if (isLoading) {
    return null;
  }

  if (error) {
    return (
      <VStack gap={4} align="center" py={8}>
        <Text color="red.500">Error loading run plans</Text>
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
    return <ExternalSetDetailPanel scenarioSetId={selectedExternalSetId} period={period} />;
  }

  if (selectedSuiteSlug === ALL_RUNS_ID) {
    return <RunHistoryPanel period={period} suiteNameMap={suiteNameMap} />;
  }

  if (selectedSuite) {
    return (
      <SuiteDetailPanel
        suite={selectedSuite}
        onEdit={() => onEditSuite(selectedSuite.id)}
        onRun={() => onRunSuite(selectedSuite.id)}
        isRunning={isRunning}
        period={period}
      />
    );
  }

  return <SuiteEmptyState onNewSuite={onNewSuite} />;
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SuitesPageContent);
