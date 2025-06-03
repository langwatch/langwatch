import { Grid, Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useEffect, useState, useRef } from "react";
import { ArrowLeft, ZoomIn, ZoomOut } from "react-feather";
import "@copilotkit/react-ui/styles.css";
import { useFetchScenarioRunsForBatch } from "~/hooks/simulations";
import { useRouter } from "next/router";
import "../simulations.css";
import { SimulationChatViewer } from "~/components/simulations";

// Main layout for a single Simulation Set page
export default function SimulationSetPage() {
  const router = useRouter();
  const [expandedSimulationId, setExpandedSimulationId] = useState<
    string | null
  >(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Get batchRunId from URL - it's an optional catch-all route
  const batchRunId =
    (Array.isArray(router.query.batchRunId)
      ? router.query.batchRunId[0] // Take first element if it's an array
      : router.query.batchRunId) ?? null;

  const { data: scenarioRunIds } = useFetchScenarioRunsForBatch({
    batchRunId,
    options: {
      refreshInterval: 1000,
    },
  });

  const isExpanded = (simulationId: string | null) =>
    expandedSimulationId === simulationId;

  const handleExpandToggle = (simulationId: string) => {
    setExpandedSimulationId(
      expandedSimulationId === simulationId ? null : simulationId
    );
  };

  // Calculate number of columns based on scale
  const getColsCount = () => {
    const baseColumns = 3;
    const calculatedColumns = Math.ceil(baseColumns / scale);
    return calculatedColumns;
  };

  // Handle zoom controls
  const handleZoomIn = () => {
    setScale(Math.min(scale + 0.1, 1.0));
  };

  const handleZoomOut = () => {
    setScale(Math.max(scale - 0.1, 0.1));
  };

  // Handle wheel zoom
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = e.deltaY || e.deltaX;
        const newScale = Math.min(Math.max(scale - delta / 50, 0.1), 1.0);
        setScale(newScale);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [scale]);

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
            <Button size="sm" variant="outline" onClick={handleZoomOut}>
              <ZoomOut size={16} />
            </Button>
            <Button size="sm" variant="outline" onClick={handleZoomIn}>
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
        <Box
          ref={containerRef}
          overflow="hidden"
          style={{
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
        >
          <Grid
            templateColumns={
              isExpanded(null) ? `repeat(${getColsCount()}, 1fr)` : "auto"
            }
            gap={6}
            style={
              isExpanded(null)
                ? {
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    width: `${100 / scale}%`,
                    height: `${100 / scale}%`,
                  }
                : {}
            }
          >
            {scenarioRunIds?.map((scenarioRunId) => (
              <Box
                key={scenarioRunId}
                width="full"
                hidden={!isExpanded(null) && !isExpanded(scenarioRunId)}
              >
                <SimulationChatViewer
                  scenarioRunId={scenarioRunId}
                  isExpanded={isExpanded(scenarioRunId)}
                  onExpandToggle={() => handleExpandToggle(scenarioRunId)}
                />
              </Box>
            ))}
          </Grid>
        </Box>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
