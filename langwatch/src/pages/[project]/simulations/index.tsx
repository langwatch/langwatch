import { Grid, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useState } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SetCard } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export default function SimulationsPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const {
    data: scenarioSetsData,
    isLoading,
    error,
  } = api.scenarios.getScenarioSetsData.useQuery(
    { projectId: project?.id ?? "" },
    {
      refetchInterval: 5000,
      enabled: !!project,
    }
  );

  const handleSetClick = (scenarioSetId: string) => {
    // Navigate to the specific set page using the catch-all route
    void router.push(`${router.pathname}/${scenarioSetId}`);
  };

  return (
    <DashboardLayout>
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <PageLayout.Header>
          <HStack justify="space-between" align="center" w="full">
            <PageLayout.Heading>Simulation Sets</PageLayout.Heading>
          </HStack>
        </PageLayout.Header>

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
            <Text fontSize="sm" color="gray.600">
              {error.message}
            </Text>
          </VStack>
        )}

        {/* Show empty state when no batches */}
        {!isLoading &&
          !error &&
          (!scenarioSetsData || scenarioSetsData.length === 0) && (
            <VStack gap={4} align="center" py={8}>
              <Text fontSize="lg" color="gray.600">
                No simulation batches found
              </Text>
              <Text fontSize="sm" color="gray.500">
                Start creating simulations to see them here
              </Text>
            </VStack>
          )}

        {/* Render based on view mode */}
        {scenarioSetsData && scenarioSetsData.length > 0 && (
          <Grid
            templateColumns="repeat(auto-fit, minmax(300px, 1fr))"
            gap={6}
            width="full"
          >
            {scenarioSetsData.map((setData) => (
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
