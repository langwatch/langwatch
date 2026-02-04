"use client";
// Internal pages don't need to be server rendering

import { useState } from "react";
import { HStack, Spacer, Spinner, Text, VStack } from "@chakra-ui/react";
import { Plus } from "lucide-react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { ScenarioCreateModal } from "~/components/scenarios/ScenarioCreateModal";
import { ScenarioEmptyState } from "~/components/scenarios/ScenarioEmptyState";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { ScenarioTable } from "~/components/scenarios/ScenarioTable";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useLabelFilter } from "~/hooks/scenarios/useLabelFilter";
import { useDrawer } from "~/hooks/useDrawer";
import { useLicenseEnforcement } from "~/hooks/useLicenseEnforcement";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

function ScenarioLibraryPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();
  const { checkAndProceed } = useLicenseEnforcement("scenarios");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const {
    data: scenarios,
    isLoading,
    error,
  } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

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
    checkAndProceed(() => {
      setIsCreateModalOpen(true);
    });
  };

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

      <PageLayout.Container>
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
          <ScenarioTable
            scenarios={scenarios}
            columnFilters={columnFilters}
            onColumnFiltersChange={setColumnFilters}
            onRowClick={handleRowClick}
          />
        )}
      </PageLayout.Container>

      <ScenarioFormDrawer open={drawerOpen("scenarioEditor")} />
      <ScenarioCreateModal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(ScenarioLibraryPage);
