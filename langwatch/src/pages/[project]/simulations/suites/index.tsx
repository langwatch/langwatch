/**
 * Suites page - Create, manage, and run simulation suites.
 *
 * Uses a query parameter `?suite=<slug>` to select a suite:
 *   /simulations/suites              (all runs view)
 *   /simulations/suites?suite=my-slug (specific suite view)
 *
 * Layout: sidebar (search, +New Suite, All Runs, suite list) + main panel.
 */

import { Box, HStack, Skeleton, Spacer, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useCallback, useMemo, useState } from "react";
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
import {
  ALL_RUNS_ID,
  extractExternalSetId,
  isExternalSetSelection,
  useSuiteRouting,
} from "~/components/suites/useSuiteRouting";
import { useRunSuite } from "~/components/suites/useRunSuite";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const SKELETON_PLACEHOLDER_COUNT = 5;

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
    { projectId: project?.id ?? "" },
    { enabled: !!project, refetchInterval: 15000 },
  );

  const { data: allRunData } = api.scenarios.getSuiteRunData.useQuery(
    {
      projectId: project?.id ?? "",
      limit: 100,
      startDate: period.startDate.getTime(),
      endDate: period.endDate.getTime(),
    },
    { enabled: !!project, refetchInterval: 5000 },
  );

  const runSummaries = useMemo(() => {
    if (!allRunData) return undefined;
    return computeSuiteRunSummaries({
      runs: allRunData.runs,
      scenarioSetIds: allRunData.scenarioSetIds,
    });
  }, [allRunData]);

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
        title: "Suite archived",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to archive suite",
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
        title: "Suite duplicated",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to duplicate suite",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const { requestRun, isPending: isRunPending, confirmationDialog } = useRunSuite({
    onRunScheduled: (suiteId) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (suite) navigateToSuite(suite.slug);
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
      requestRun(suite);
    },
    [requestRun],
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
      if (suite) requestRun(suite);
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
    <DashboardLayout>
      <PageLayout.Header>
        <HStack justify="space-between" align="center" w="full">
          <PageLayout.Heading>Suites</PageLayout.Heading>
          <Spacer />
          <PeriodSelector period={period} setPeriod={setPeriod} />
          <PageLayout.HeaderButton onClick={handleNewSuite}>
            <Plus size={16} /> New Suite
          </PageLayout.HeaderButton>
        </HStack>
      </PageLayout.Header>
      <HStack w="full" flex={1} alignItems="stretch" gap={0} overflow="hidden">
        {/* Sidebar */}
        {isLoading ? (
          <VStack
            width="280px"
            minWidth="280px"
            padding={4}
            gap={3}
            align="stretch"
          >
            {Array.from({ length: SKELETON_PLACEHOLDER_COUNT }).map((_, index) => (
              <Box key={index} data-testid="suite-sidebar-skeleton">
                <Skeleton height="20px" width="70%" borderRadius="md" />
                <Skeleton
                  height="16px"
                  width="40%"
                  borderRadius="md"
                  marginTop={2}
                />
              </Box>
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

        {/* Main Panel */}
        <Box flex={1} overflow="auto">
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
      </HStack>

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
      {confirmationDialog}
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
        <Text color="red.500">Error loading suites</Text>
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
    return <ExternalSetDetailPanel scenarioSetId={selectedExternalSetId} />;
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
