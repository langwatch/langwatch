"use client";

// Internal pages don't need to be server rendering

import { HStack, Spacer, Spinner, VStack } from "@chakra-ui/react";
import {
  ScenarioArchiveDialog,
  ScenarioBatchActionBar as BatchActionBar,
  ScenarioEmptyState,
  ScenarioLabelFilter as LabelFilterDropdown,
  ScenarioWelcomeModal,
  ScenarioWelcomeScreen,
  useNewScenarioFlow,
  useScenarioLabelFilter as useLabelFilter,
  useScenarioSelection,
} from "../../index";
import { Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { DashboardLayout } from "../../ui/sections/dashboard-layout";
import { ScenarioCreateModal } from "../../components/scenarios/scenario-create-modal";
import { ScenarioTable } from "../../components/scenarios/scenario-table";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { toaster } from "@langwatch/design-system/toaster";
import { HandledErrorAlert, showErrorToast } from "../../behavior/errors";
import type { Scenario } from "../../model/prisma-types";
import { useDrawer } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project";
import { usePreloadDrawer } from "../../behavior/use-preload-drawer";
import { api } from "../../behavior/scenario-api";

function ScenarioLibraryPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  // Every row here opens the scenario editor, which is a separate download.
  // Fetch it while the person reads the list, so the click opens the editor
  // rather than a spinner.
  usePreloadDrawer("scenarioEditor");
  const { rowSelection, onRowSelectionChange, selectedIds, selectionCount, deselectAll } =
    useScenarioSelection();

  // Archive dialog state
  const [archiveTarget, setArchiveTarget] = useState<
    { type: "single"; scenario: Scenario } | { type: "batch" } | null
  >(null);

  const utils = api.useUtils();

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
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't archive scenario",
      }),
  });

  const batchArchiveMutation = api.scenarios.batchArchive.useMutation({
    onSuccess: (result) => {
      if (result.failed.length > 0) {
        toaster.create({
          title: "Some scenarios couldn't be archived",
          description: `${result.failed.length} failed. Please retry.`,
          type: "error",
        });
      }
      void utils.scenarios.getAll.invalidate();
      deselectAll();
      setArchiveTarget(null);
    },
    onError: (err) =>
      showErrorToast({
        error: err,
        fallbackTitle: "Couldn't archive scenarios",
      }),
  });

  const { columnFilters, setColumnFilters, allLabels, activeLabels, handleLabelToggle } =
    useLabelFilter(scenarios);

  const {
    showInlineWelcome,
    showWelcomeModal,
    showCreateModal,
    handleNewScenario,
    handleWelcomeProceed,
    handleWelcomeModalOpenChange,
    handleCloseCreateModal,
  } = useNewScenarioFlow({ scenarioCount: scenarios?.length ?? 0, isLoading });

  const handleRowClick = (scenarioId: string) => {
    openDrawer("scenarioEditor", { urlParams: { scenarioId } });
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
            <HandledErrorAlert error={error} fallbackTitle="Couldn't load scenarios" />
          </VStack>
        )}

        {!isLoading && !error && scenarios?.length === 0 && showInlineWelcome && (
          <ScenarioWelcomeScreen onProceed={handleWelcomeProceed} />
        )}

        {!isLoading && !error && scenarios?.length === 0 && !showInlineWelcome && (
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

      {/* ScenarioFormDrawerFromUrl is mounted globally by CurrentDrawer via
          the drawer registry (#3194). Rendering it explicitly here as well
          duplicates the role="dialog" element in the DOM and breaks
          accessible selectors / Playwright targeting. */}
      <ScenarioWelcomeModal
        open={showWelcomeModal}
        onOpenChange={handleWelcomeModalOpenChange}
        onProceed={handleWelcomeProceed}
      />
      <ScenarioCreateModal open={showCreateModal} onClose={handleCloseCreateModal} />
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


/**
 * The guard is the ROUTE's, and it did not travel.
 *
 * `withPermissionGuard("scenarios:view")` and, for Agent Testing,
 * `withFeatureFlagGuard("release_ui_agent_testing_v2_enabled")` state a policy
 * about an ADDRESS — flags before permissions, nothing refused while an answer
 * is still arriving — and the composing application states it in front of the
 * loader, where a refusal can render the application's own fallback. The
 * `layoutComponent: DashboardLayout` half is chrome, and chrome belongs to the
 * route tree.
 */
export default ScenarioLibraryPage;
