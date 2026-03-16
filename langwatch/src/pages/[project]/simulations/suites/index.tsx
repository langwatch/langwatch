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
import { useSuiteRunMutation } from "~/components/suites/useSuiteRunMutation";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";
import {
  ALL_RUNS_ID,
  extractExternalSetId,
  isExternalSetSelection,
  useSuiteRouting,
} from "~/components/suites/useSuiteRouting";
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

  // Use a ref for handleEditSuite to break circular dependency:
  // handleRunRequested → runMutation → useSuiteRunMutation({ onEditSuite }) → handleEditSuite → handleRunRequested
  const handleEditSuiteRef = useRef<(suiteId: string) => void>(() => {});

  const { runMutation } = useSuiteRunMutation({
    onEditSuite: (suiteId: string) => handleEditSuiteRef.current(suiteId),
    onSuccess: () => {
      setSuiteRunSinceTimestamp(undefined);
      void utils.scenarios.getSuiteRunData.invalidate();
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
      runMutation.mutate({ projectId: project?.id ?? "", id: suite.id, idempotencyKey: crypto.randomUUID() });
    },
    [navigateToSuite, runMutation, project?.id],
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

  handleEditSuiteRef.current = handleEditSuite;

  const handleRunSuite = useCallback(
    (suiteId: string) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (suite) navigateToSuite(suite.slug);
      runMutation.mutate({ projectId: project?.id ?? "", id: suiteId, idempotencyKey: crypto.randomUUID() });
    },
    [suites, navigateToSuite, runMutation, project?.id],
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

  const updateLabelsMutation = api.suites.update.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to update labels",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const handleAddLabel = useCallback(
    (label: string) => {
      if (!project || !selectedSuite || updateLabelsMutation.isPending) return;
      updateLabelsMutation.mutate({
        projectId: project.id,
        id: selectedSuite.id,
        labels: [...selectedSuite.labels, label],
      });
    },
    [project, selectedSuite, updateLabelsMutation],
  );

  const handleRemoveLabel = useCallback(
    (label: string) => {
      if (!project || !selectedSuite || updateLabelsMutation.isPending) return;
      updateLabelsMutation.mutate({
        projectId: project.id,
        id: selectedSuite.id,
        labels: selectedSuite.labels.filter((l) => l !== label),
      });
    },
    [project, selectedSuite, updateLabelsMutation],
  );

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
            isRunning={runMutation.isPending}
            period={period}
            suiteNameMap={suiteNameMap}
            onAddLabel={handleAddLabel}
            onRemoveLabel={handleRemoveLabel}
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
  onAddLabel,
  onRemoveLabel,
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
  onAddLabel: (label: string) => void;
  onRemoveLabel: (label: string) => void;
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
        onAddLabel={onAddLabel}
        onRemoveLabel={onRemoveLabel}
      />
    );
  }

  return <SuiteEmptyState onNewSuite={onNewSuite} />;
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SuitesPageContent);
