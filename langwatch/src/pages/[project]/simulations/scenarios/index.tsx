import { HStack, Spinner, Spacer, Text, VStack } from "@chakra-ui/react";
import type { ColumnFiltersState } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { ScenarioEmptyState } from "~/components/scenarios/ScenarioEmptyState";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import { LabelFilterDropdown } from "~/components/scenarios/LabelFilterDropdown";
import { ScenarioTable } from "~/components/scenarios/ScenarioTable";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";

function ScenarioLibraryPage() {
  const { project } = useOrganizationTeamProject();
  const { openDrawer, drawerOpen } = useDrawer();
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);

  const {
    data: scenarios,
    isLoading,
    error,
  } = api.scenarios.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const allLabels = useMemo(() => {
    if (!scenarios) return [];
    const labels = new Set<string>();
    scenarios.forEach((s) => s.labels.forEach((l) => labels.add(l)));
    return Array.from(labels).sort();
  }, [scenarios]);

  const activeLabels = useMemo(() => {
    const labelsFilter = columnFilters.find((f) => f.id === "labels");
    return (labelsFilter?.value as string[]) ?? [];
  }, [columnFilters]);

  const handleLabelToggle = (label: string) => {
    setColumnFilters((prev) => {
      const labelsFilter = prev.find((f) => f.id === "labels");
      const currentLabels = (labelsFilter?.value as string[]) ?? [];
      const newLabels = currentLabels.includes(label)
        ? currentLabels.filter((l) => l !== label)
        : [...currentLabels, label];

      const otherFilters = prev.filter((f) => f.id !== "labels");
      if (newLabels.length === 0) return otherFilters;
      return [...otherFilters, { id: "labels", value: newLabels }];
    });
  };

  const handleRowClick = (scenarioId: string) => {
    openDrawer("scenarioEditor", { urlParams: { scenarioId } });
  };

  const handleNewScenario = () => {
    openDrawer("scenarioEditor");
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

        {error && (
          <VStack gap={4} align="center" py={8}>
            <Text color="red.500">Error loading scenarios</Text>
            <Text fontSize="sm" color="gray.600">
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
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(ScenarioLibraryPage);
