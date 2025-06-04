import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, ZoomIn, ZoomOut } from "react-feather";
import { useRouter } from "next/router";
import { SimulationZoomGrid } from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useZoom } from "~/hooks/useZoom";
import { useFetchScenarioRunsForBatch } from "~/hooks/simulations";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";

// Main layout for a single Simulation Set page
export function SimulationSetPage({ batchRunId }: { batchRunId: string }) {
  const router = useRouter();
  const { scale, containerRef, zoomIn, zoomOut } = useZoom();
  const { data: scenarioRunIds } = useFetchScenarioRunsForBatch({
    batchRunId,
    options: {
      refreshInterval: 1000,
    },
  });

  return (
    <DashboardLayout position="relative">
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <Box mb={4}>
          <button onClick={() => router.back()}>
            <HStack>
              <ArrowLeft size={14} /> Back to Simulation Sets
            </HStack>
          </button>
        </Box>
        <PageLayout.Header>
          <VStack alignItems="flex-start">
            <PageLayout.Heading>Simulations</PageLayout.Heading>
            <Text fontSize="sm" color="gray.500" mt={1}>
              Batch ID: {batchRunId}
            </Text>
          </VStack>
          <HStack position="absolute" right={6} top={8} gap={2}>
            <Button size="sm" variant="outline" onClick={zoomOut}>
              <ZoomOut size={16} />
            </Button>
            <Button size="sm" variant="outline" onClick={zoomIn}>
              <ZoomIn size={16} />
            </Button>
            <Box
              px={2}
              py={1}
              bg="gray.100"
              borderRadius="md"
              fontSize="xs"
              fontFamily="mono"
            >
              {Math.round(scale * 100)}%
            </Box>
          </HStack>
        </PageLayout.Header>
        {/* Use the SimulationZoomGrid component for the grid of simulations */}
        {scenarioRunIds && (
          <SimulationZoomGrid
            scenarioRunIds={scenarioRunIds}
            scale={scale}
            containerRef={containerRef}
          />
        )}
      </PageLayout.Container>
    </DashboardLayout>
  );
}
