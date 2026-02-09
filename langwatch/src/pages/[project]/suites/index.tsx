"use client";

/**
 * Suites page - Create, manage, and run simulation suites.
 *
 * Layout: sidebar (search, +New Suite, All Runs, suite list) + main panel.
 */

import { Box, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import type { SimulationSuiteConfiguration } from "@prisma/client";
import { useCallback, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SuiteContextMenu } from "~/components/suites/SuiteContextMenu";
import {
  SuiteDetailPanel,
  SuiteEmptyState,
} from "~/components/suites/SuiteDetailPanel";
import { SuiteFormDrawer } from "~/components/suites/SuiteFormDrawer";
import { SuiteSidebar } from "~/components/suites/SuiteSidebar";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function SuitesPageContent() {
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  // State
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSuite, setEditingSuite] =
    useState<SimulationSuiteConfiguration | null>(null);
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

  const selectedSuite = suites?.find((s) => s.id === selectedSuiteId) ?? null;

  // Mutations
  const deleteMutation = api.suites.delete.useMutation({
    onSuccess: () => {
      void utils.suites.getAll.invalidate();
      if (selectedSuiteId === deleteConfirmId) {
        setSelectedSuiteId(null);
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
  const handleNewSuite = useCallback(() => {
    setEditingSuite(null);
    setDrawerOpen(true);
  }, []);

  const handleEditSuite = useCallback(
    (suiteId: string) => {
      const suite = suites?.find((s) => s.id === suiteId);
      if (suite) {
        setEditingSuite(suite);
        setDrawerOpen(true);
      }
    },
    [suites],
  );

  const handleRunSuite = useCallback(
    (suiteId: string) => {
      if (!project) return;
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
      // Simple confirmation via window.confirm for now
      if (window.confirm("Are you sure you want to delete this suite?")) {
        setDeleteConfirmId(suiteId);
        deleteMutation.mutate({ projectId: project.id, id: suiteId });
      }
    },
    [project, deleteMutation],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, suiteId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, suiteId });
    },
    [],
  );

  const handleSuiteSaved = useCallback(
    (suite: SimulationSuiteConfiguration) => {
      setSelectedSuiteId(suite.id);
    },
    [],
  );

  const handleSuiteRan = useCallback((suiteId: string) => {
    setSelectedSuiteId(suiteId);
  }, []);

  return (
    <DashboardLayout>
      <HStack height="calc(100vh - 60px)" align="stretch" gap={0}>
        {/* Sidebar */}
        {isLoading ? (
          <VStack width="280px" minWidth="280px" justify="center" align="center">
            <Spinner />
          </VStack>
        ) : (
          <SuiteSidebar
            suites={suites ?? []}
            selectedSuiteId={selectedSuiteId}
            onSelectSuite={setSelectedSuiteId}
            onNewSuite={handleNewSuite}
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

          {!error && !selectedSuite && <SuiteEmptyState />}

          {selectedSuite && (
            <SuiteDetailPanel
              suite={selectedSuite}
              onEdit={() => handleEditSuite(selectedSuite.id)}
              onRun={() => handleRunSuite(selectedSuite.id)}
            />
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

      {/* Form drawer */}
      <SuiteFormDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        suite={editingSuite}
        onSaved={handleSuiteSaved}
        onRan={handleSuiteRan}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SuitesPageContent);
