import { Button, EmptyState, Grid, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { ButtonGroup } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SetCard } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import ScenarioInfoCard from "~/components/simulations/ScenarioInfoCard";
import React, { useEffect, useState } from "react";

export default function SimulationsPage() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const [refetchInterval, setRefetchInterval] = useState(4000);

  // Refetch interval is set to 4 seconds when the window is focused and 30 seconds when the window is blurred.
  useEffect(() => {
    const onFocus = () => setRefetchInterval(4000);
    const onBlur = () => setRefetchInterval(30000);

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const {
    data: scenarioSetsData,
    isLoading,
    error,
    refetch,
  } = api.scenarios.getScenarioSetsData.useQuery(
    { projectId: project?.id ?? "" },
    {
      refetchInterval,
      enabled: !!project,
    }
  );

  const handleSetClick = (scenarioSetId: string) => {
    // Navigate to the specific set page using the catch-all route
    void router.push(`${router.asPath}/${scenarioSetId}`);
  };

  return (
    <DashboardLayout>
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <PageLayout.Header>
          {!isLoading && scenarioSetsData && scenarioSetsData.length > 0 && (
            <HStack justify="space-between" align="center" w="full">
              <PageLayout.Heading>Simulation Sets</PageLayout.Heading>
            </HStack>
          )}
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
            <ScenarioInfoCard />
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
