"use client";

/**
 * Suites page - Create, manage, and run simulation suites.
 *
 * Layout: sidebar (search, +New Suite, All Runs, suite list) + main panel.
 */

import { Box, Button, HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import type { SimulationSuite } from "@prisma/client";
import { useCallback, useMemo, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { AllRunsPanel } from "~/components/suites/AllRunsPanel";
import { SuiteContextMenu } from "~/components/suites/SuiteContextMenu";
import {
  SuiteDetailPanel,
  SuiteEmptyState,
} from "~/components/suites/SuiteDetailPanel";
import { SuiteSidebar } from "~/components/suites/SuiteSidebar";
import { computeSuiteRunSummaries } from "~/components/suites/run-history-transforms";
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
  DialogFooter,
  DialogCloseTrigger,
} from "~/components/ui/dialog";
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

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

  // Mutations
  const deleteMutation = api.suites.delete.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
      if (selectedSuiteId === deleteConfirmId) {
        setSelectedSuiteId("all-runs");
      }
      setDeleteConfirmId(null);
      toaster.create({
        title: "Suite deleted",
        type: "success",
        meta: { closable: true },
      });
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to delete suite",
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

  const handleDeleteSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
      setDeleteConfirmId(suiteId);
    },
    [project],
  );

  const confirmDelete = useCallback(() => {
    if (!project || !deleteConfirmId) return;
    deleteMutation.mutate({ projectId: project.id, id: deleteConfirmId });
  }, [project, deleteConfirmId, deleteMutation]);

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
          {error && (
            <VStack gap={4} align="center" py={8}>
              <Text color="red.500">Error loading suites</Text>
              <Text fontSize="sm" color="fg.muted">
                {error.message}
              </Text>
            </VStack>
          )}

          {!error && selectedSuiteId === "all-runs" && <AllRunsPanel />}

          {!error && !selectedSuiteId && <SuiteEmptyState onNewSuite={handleNewSuite} />}

          {selectedSuite && (
            <SuiteDetailPanel
              suite={selectedSuite}
              onEdit={() => handleEditSuite(selectedSuite.id)}
              onRun={() => handleRunSuite(selectedSuite.id)}
              isRunning={runMutation.isPending}
            />
          )}

          {!error && selectedSuiteId && selectedSuiteId !== "all-runs" && !selectedSuite && !isLoading && (
            <SuiteEmptyState onNewSuite={handleNewSuite} />
          )}
        </Box>
      </HStack>

      {/* Context menu */}
      {contextMenu && (
        <SuiteContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onEdit={() => handleEditSuite(contextMenu.suiteId)}
          onDuplicate={() => handleDuplicateSuite(contextMenu.suiteId)}
          onDelete={() => handleDeleteSuite(contextMenu.suiteId)}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      <DialogRoot
        open={!!deleteConfirmId}
        onOpenChange={(e) => {
          if (!e.open) setDeleteConfirmId(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Suite</DialogTitle>
            <DialogCloseTrigger />
          </DialogHeader>
          <DialogBody>
            <Text>
              Are you sure you want to delete this suite? This action cannot be
              undone.
            </Text>
          </DialogBody>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmId(null)}
            >
              Cancel
            </Button>
            <Button
              colorPalette="red"
              onClick={confirmDelete}
              loading={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SuitesPageContent);
