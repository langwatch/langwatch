import { Grid, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useMemo } from "react";
import {
  SetCard,
} from "~/components/simulations";
import ScenarioInfoCard from "~/components/simulations/ScenarioInfoCard";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export function SimulationsGridView() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();

  const {
    data: scenarioSetsData = [],
    isLoading,
    error,
  } = api.scenarios.getScenarioSetsData.useQuery(
    { projectId: project?.id ?? "" },
    {
      refetchInterval: () => {
        return window.document.hasFocus() ? 4000 : 30000;
      },
      enabled: !!project,
    }
  );

  const sortedScenarioSetsData = useMemo(() => {
    return scenarioSetsData.toSorted((a, b) => b.lastRunAt - a.lastRunAt);
  }, [scenarioSetsData]);

  const handleSetClick = (scenarioSetId: string) => {
    // Navigate to the specific set page using the catch-all route
    void router.push(`${router.asPath.split("?")[0]}/${scenarioSetId}`);
  };

  // Grid view content
  return (
    <>
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

      {/* Render grid of scenario sets */}
      {sortedScenarioSetsData && sortedScenarioSetsData.length > 0 && (
        <Grid
          templateColumns="repeat(auto-fit, minmax(300px, 1fr))"
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
    </>
  );
}
