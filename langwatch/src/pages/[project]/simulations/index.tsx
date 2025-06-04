import { Grid, Spinner, Text, VStack } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { BatchCard } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useFetchScenarioBatches } from "~/hooks/simulations";

export default function SimulationsPage() {
  const router = useRouter();

  // Fetch all batch run IDs with scenario counts
  const {
    data: batches,
    isLoading,
    error,
  } = useFetchScenarioBatches({
    refreshInterval: 5000, // Refresh every 5 seconds to show new batches
  });

  const handleBatchClick = (batchRunId: string) => {
    // Navigate to the specific batch page using the catch-all route
    void router.push(`${router.asPath}/${batchRunId}`);
  };

  return (
    <DashboardLayout>
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <PageLayout.Header>
          <PageLayout.Heading>Simulation Batches</PageLayout.Heading>
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
        {!isLoading && !error && (!batches || batches.length === 0) && (
          <VStack gap={4} align="center" py={8}>
            <Text fontSize="lg" color="gray.600">
              No simulation batches found
            </Text>
            <Text fontSize="sm" color="gray.500">
              Start creating simulations to see them here
            </Text>
          </VStack>
        )}

        {/* Grid layout for batch cards */}
        {batches && batches.length > 0 && (
          <Grid
            templateColumns="repeat(auto-fit, minmax(300px, 1fr))"
            gap={6}
            width="full"
          >
            {batches.map((batch) => (
              <BatchCard
                key={batch.batchRunId}
                title={batch.batchRunId}
                scenarioCount={batch.scenarioCount}
                successRate={batch.successRate}
                lastRunAt={batch.lastRunAt ? new Date(batch.lastRunAt) : null}
                onClick={() => handleBatchClick(batch.batchRunId)}
              />
            ))}
          </Grid>
        )}
      </PageLayout.Container>
    </DashboardLayout>
  );
}
