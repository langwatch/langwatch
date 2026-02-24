"use client";

/**
 * Suites page - Create, manage, and run simulation suites.
 *
 * Layout: sidebar (search, +New Suite, All Runs, suite list) + main panel.
 */

import { Box, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useCallback, useMemo, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { AllRunsPanel } from "~/components/suites/AllRunsPanel";
import { SuiteArchiveDialog } from "~/components/suites/SuiteArchiveDialog";
import { SuiteContextMenu } from "~/components/suites/SuiteContextMenu";
import {
  SuiteDetailPanel,
  SuiteEmptyState,
} from "~/components/suites/SuiteDetailPanel";
import { SuiteSidebar } from "~/components/suites/SuiteSidebar";
import { computeSuiteRunSummaries } from "~/components/suites/run-history-transforms";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function SuitesPageContent() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, setFlowCallbacks } = useDrawer();
  const utils = api.useContext();

  // State
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | "all-runs" | null>("all-runs");
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

  const { data: allRunData } = api.scenarios.getAllSuiteRunData.useQuery(
    { projectId: project?.id ?? "", limit: 100 },
    { enabled: !!project, refetchInterval: 5000 },
  );

  const runSummaries = useMemo(() => {
    if (!allRunData) return undefined;
    return computeSuiteRunSummaries({
      runs: allRunData.runs,
      scenarioSetIds: allRunData.scenarioSetIds,
    });
  }, [allRunData]);

  const selectedSuite = typeof selectedSuiteId === "string" && selectedSuiteId !== "all-runs"
    ? suites?.find((s) => s.id === selectedSuiteId) ?? null
    : null;

  const archiveTargetSuite = archiveConfirmId
    ? suites?.find((s) => s.id === archiveConfirmId)
    : null;

  // Mutations
  const archiveMutation = api.suites.archive.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
      if (selectedSuiteId === archiveConfirmId) {
        setSelectedSuiteId("all-runs");
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
      setSelectedSuiteId(data.id);
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

  const runMutation = api.suites.run.useMutation({
    onSuccess: (result) => {
      toaster.create({
        title: `Suite run scheduled (${result.jobCount} jobs)`,
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to run suite",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  // Handlers
  const handleSuiteSaved = useCallback(
    (suite: SimulationSuite) => {
      setSelectedSuiteId(suite.id);
    },
    [],
  );

  const handleSuiteRan = useCallback((suiteId: string) => {
    setSelectedSuiteId(suiteId);
  }, []);

  const handleNewSuite = useCallback(() => {
    setFlowCallbacks("suiteEditor", {
      onSaved: handleSuiteSaved,
      onRan: handleSuiteRan,
    });
    openDrawer("suiteEditor");
  }, [openDrawer, setFlowCallbacks, handleSuiteSaved, handleSuiteRan]);

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      setFlowCallbacks("suiteEditor", {
        onSaved: handleSuiteSaved,
        onRan: handleSuiteRan,
      });
      openDrawer("suiteEditor", { urlParams: { suiteId } });
    },
    [openDrawer, setFlowCallbacks, handleSuiteSaved, handleSuiteRan],
  );

  const handleRunSuite = useCallback(
    (suiteId: string) => {
      if (!project || runMutation.isPending) return;
      setSelectedSuiteId(suiteId);
      runMutation.mutate({ projectId: project.id, id: suiteId });
    },
    [project, runMutation],
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
          <PageLayout.HeaderButton onClick={handleNewSuite}>
            <Plus size={16} /> New Suite
          </PageLayout.HeaderButton>
        </HStack>
      </PageLayout.Header>
      <HStack w="full" flex={1} alignItems="stretch" gap={0} overflow="hidden">
        {/* Sidebar */}
        {isLoading ? (
          <VStack width="280px" minWidth="280px" justify="center" align="center">
            <Spinner />
          </VStack>
        ) : (
          <SuiteSidebar
            suites={suites ?? []}
            selectedSuiteId={selectedSuiteId}
            runSummaries={runSummaries}
            onSelectSuite={setSelectedSuiteId}
            onRunSuite={handleRunSuite}
            onContextMenu={handleContextMenu}
          />
        )}

        {/* Main Panel */}
        <Box flex={1} overflow="auto">
          <MainPanel
            error={error ?? null}
            selectedSuiteId={selectedSuiteId}
            selectedSuite={selectedSuite}
            isLoading={isLoading}
            onNewSuite={handleNewSuite}
            onEditSuite={handleEditSuite}
            onRunSuite={handleRunSuite}
            isRunning={runMutation.isPending}
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
  selectedSuiteId,
  selectedSuite,
  isLoading,
  onNewSuite,
  onEditSuite,
  onRunSuite,
  isRunning,
}: {
  error: { message: string } | null;
  selectedSuiteId: string | "all-runs" | null;
  selectedSuite: SimulationSuite | null;
  isLoading: boolean;
  onNewSuite: () => void;
  onEditSuite: (id: string) => void;
  onRunSuite: (id: string) => void;
  isRunning: boolean;
}) {
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

  if (selectedSuiteId === "all-runs") {
    return <AllRunsPanel />;
  }

  if (selectedSuite) {
    return (
      <SuiteDetailPanel
        suite={selectedSuite}
        onEdit={() => onEditSuite(selectedSuite.id)}
        onRun={() => onRunSuite(selectedSuite.id)}
        isRunning={isRunning}
      />
    );
  }

  if (!selectedSuiteId || !isLoading) {
    return <SuiteEmptyState onNewSuite={onNewSuite} />;
  }

  return null;
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SuitesPageContent);
