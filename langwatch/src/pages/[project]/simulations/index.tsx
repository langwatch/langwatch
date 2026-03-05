import { Grid, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import React, { useMemo } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SetCard } from "~/components/simulations";
import ScenarioInfoCard from "~/components/simulations/ScenarioInfoCard";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { api } from "~/utils/api";
import { sortScenarioSets } from "~/features/simulations/sort-scenario-sets";

function SimulationsPageContent() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const {
    data: scenarioSetsData,
    isLoading,
    error,
    refetch,
  } = api.scenarios.getScenarioSetsData.useQuery(
    { projectId: project?.id ?? "" },
    {
      refetchInterval: 60_000,
      enabled: !!project,
    },
  );

  useSimulationUpdateListener({
    projectId: project?.id ?? "",
    refetch,
    enabled: !!project,
  });

  const sortedScenarioSetsData = useMemo(() => {
    if (!scenarioSetsData) {
      return undefined;
    }

    return sortScenarioSets(scenarioSetsData);
  }, [scenarioSetsData]);

  const handleSetClick = (scenarioSetId: string) => {
    // Navigate to the specific set page using the catch-all route
    void router.push(`${router.asPath}/${scenarioSetId}`);
  };

  return (
    <DashboardLayout>
      {!isLoading &&
        sortedScenarioSetsData &&
        sortedScenarioSetsData.length > 0 && (
          <PageLayout.Header>
            <HStack justify="space-between" align="center" w="full">
              <PageLayout.Heading>Simulation Sets</PageLayout.Heading>
            </HStack>
          </PageLayout.Header>
        )}
      <PageLayout.Container maxW={"calc(100vw - 200px)"} padding={6}>
        {/* Show loading state */}
        {isLoading && (
          <VStack gap={4} align="center" py={8}>
            <Spinner borderWidth="3px" animationDuration="0.8s" />
          </VStack>
        )}

        {/* Show error state */}
        {error && (
          <VStack gap={4} align="center" py={8}>
            <Text color="red.500">Error loading simulation batches</Text>
            <Text fontSize="sm" color="fg.muted">
              {error.message}
            </Text>
          </VStack>
        )}

        {/* Show empty state when no batches */}
        {!isLoading &&
          !error &&
          (!scenarioSetsData || scenarioSetsData.length === 0) && (
            <ScenarioInfoCard />
          )}

        {/* Render based on view mode */}
        {sortedScenarioSetsData && sortedScenarioSetsData.length > 0 && (
          <Grid
            templateColumns="repeat(auto-fill, minmax(260px, 1fr))"
            gap={6}
            width="full"
          >
            {sortedScenarioSetsData.map((setData) => (
              <SetCard
                {...setData}
                key={setData.scenarioSetId}
                onClick={() => handleSetClick(setData.scenarioSetId)}
              />
            ))}
          </Grid>
        )}
      </PageLayout.Container>
    </DashboardLayout>
  );
}

export default withPermissionGuard("scenarios:view", {
  layoutComponent: DashboardLayout,
})(SimulationsPageContent);
