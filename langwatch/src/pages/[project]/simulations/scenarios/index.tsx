"use client";
// Internal pages don't need to be server rendering

import { useCallback, useMemo, useState } from "react";
import { HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import type { Scenario } from "@prisma/client";
import { Plus } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { BatchActionBar } from "~/components/scenarios/BatchActionBar";
import { ScenarioArchiveDialog } from "~/components/scenarios/ScenarioArchiveDialog";
import { ScenarioCreateModal } from "~/components/scenarios/ScenarioCreateModal";
import { ScenarioEmptyState } from "~/components/scenarios/ScenarioEmptyState";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { ScenarioTable } from "~/components/scenarios/ScenarioTable";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { toaster } from "~/components/ui/toaster";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useLabelFilter } from "~/hooks/scenarios/useLabelFilter";
import { useScenarioSelection } from "~/hooks/scenarios/useScenarioSelection";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function ScenarioLibraryPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const {
    rowSelection,
    onRowSelectionChange,
    selectedIds,
    selectionCount,
    deselectAll,
  } = useScenarioSelection();

  // Archive dialog state
  const [archiveTarget, setArchiveTarget] = useState<
    { type: "single"; scenario: Scenario } | { type: "batch" } | null
  >(null);

  const utils = api.useContext();

  const {
    data: scenarios,
    isLoading,
    error,
  } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  const handleArchiveSuccess = useCallback(() => {
    void utils.scenarios.getAll.invalidate();
    deselectAll();
    setArchiveTarget(null);
  }, [utils.scenarios.getAll, deselectAll]);

  const archiveMutation = api.scenarios.archive.useMutation({
    onSuccess: handleArchiveSuccess,
    onError: (err) => {
      toaster.create({
        title: "Failed to archive scenario",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const batchArchiveMutation = api.scenarios.batchArchive.useMutation({
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toaster.create({
          title: "Some scenarios couldn't be archived",
          description: `${result.failed.length} failed. Please retry.`,
          type: "error",
          meta: { closable: true },
        });
      }
      void utils.scenarios.getAll.invalidate();
      deselectAll();
      setArchiveTarget(null);
    },
    onError: (err) => {
      toaster.create({
        title: "Failed to archive scenarios",
        description: err.message,
        type: "error",
        meta: { closable: true },
      });
    },
  });

  const {
    columnFilters,
    setColumnFilters,
    allLabels,
    activeLabels,
    handleLabelToggle,
  } = useLabelFilter(scenarios);

  const handleRowClick = (scenarioId: string) => {
    openDrawer("scenarioEditor", { urlParams: { scenarioId } });
  };

  const handleNewScenario = () => {
    setIsCreateModalOpen(true);
  };

  const handleArchiveSingle = useCallback((scenario: Scenario) => {
    setArchiveTarget({ type: "single", scenario });
  }, []);

  const handleArchiveBatch = useCallback(() => {
    setArchiveTarget({ type: "batch" });
  }, []);

  const handleConfirmArchive = () => {
    if (!project?.id) return;

    if (archiveTarget?.type === "single") {
      archiveMutation.mutate({
        projectId: project.id,
        id: archiveTarget.scenario.id,
      });
    } else if (archiveTarget?.type === "batch") {
      batchArchiveMutation.mutate({
        projectId: project.id,
        ids: selectedIds,
      });
    }
  };

  const handleCloseArchiveDialog = () => {
    setArchiveTarget(null);
  };

  const scenariosToArchive = useMemo((): { id: string; name: string }[] => {
    if (!archiveTarget || !scenarios) return [];
    if (archiveTarget.type === "single") {
      return [
        {
          id: archiveTarget.scenario.id,
          name: archiveTarget.scenario.name,
        },
      ];
    }
    // Batch: resolve selected IDs to scenario names
    return scenarios
      .filter((s) => selectedIds.includes(s.id))
      .map((s) => ({ id: s.id, name: s.name }));
  }, [archiveTarget, scenarios, selectedIds]);

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <HStack justify="space-between" align="center" w="full">
          <PageLayout.Heading>Scenario Library</PageLayout.Heading>
          <Spacer />
          <LabelFilterDropdown
            allLabels={allLabels}
            activeLabels={activeLabels}
            onToggle={handleLabelToggle}
          />
          <PageLayout.HeaderButton onClick={handleNewScenario}>
            <Plus size={16} /> New Scenario
          </PageLayout.HeaderButton>
        </HStack>
      </PageLayout.Header>

      <PageLayout.Container padding={0}>
        {isLoading && (
          <VStack gap={4} align="center" py={8}>
            <Spinner borderWidth="3px" animationDuration="0.8s" />
          </VStack>
        )}

        {error && !scenarios?.length && (
          <VStack gap={4} align="center" py={8}>
            <Text color="red.500">Error loading scenarios</Text>
            <Text fontSize="sm" color="fg.muted">
              {error.message}
            </Text>
          </VStack>
        )}

        {!isLoading && !error && scenarios?.length === 0 && (
          <ScenarioEmptyState onCreateClick={handleNewScenario} />
        )}

        {scenarios && scenarios.length > 0 && (
          <>
            <BatchActionBar
              selectedCount={selectionCount}
              onArchive={handleArchiveBatch}
            />
            <ScenarioTable
              scenarios={scenarios}
              columnFilters={columnFilters}
              onColumnFiltersChange={setColumnFilters}
              onRowClick={handleRowClick}
              rowSelection={rowSelection}
              onRowSelectionChange={onRowSelectionChange}
              onArchive={handleArchiveSingle}
            />
          </>
        )}
      </PageLayout.Container>

      <ScenarioFormDrawer open={drawerOpen("scenarioEditor")} />
      <ScenarioCreateModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
      <ScenarioArchiveDialog
        open={archiveTarget !== null}
        onClose={handleCloseArchiveDialog}
        onConfirm={handleConfirmArchive}
        scenarios={scenariosToArchive}
        isLoading={archiveMutation.isPending || batchArchiveMutation.isPending}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(ScenarioLibraryPage);
