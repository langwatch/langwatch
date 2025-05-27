import { Grid, Box, Button, HStack } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationCard } from "~/components/simulations/simulation-card";
import { useEffect, useState, useRef } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { TextMessage, MessageRole } from "@copilotkit/runtime-client-gql";
import { ZoomIn, ZoomOut } from "react-feather";
import "@copilotkit/react-ui/styles.css";
import {
  useFetchScenarioState,
  useFetchScenarioRuns,
} from "~/hooks/useScenarioSimulations";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/schemas";

// Main layout for the Simulation Sets page
export default function SimulationSetsPage() {
  const { project } = useOrganizationTeamProject();
  const [expandedSimulationId, setExpandedSimulationId] = useState<
    string | null
  >(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch all threads for the project
  const { data: scenarioRunIds } = useFetchScenarioRuns({
    refreshInterval: 1000,
  });

  console.log({ scenarioRunIds });

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
        <PageLayout.Header>
          <PageLayout.Heading>Simulations</PageLayout.Heading>
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
            {scenarioRunIds?.scenarioRunIds.map((scenarioRunId) => (
              <Box
                key={scenarioRunId}
                width="full"
                hidden={!isExpanded(null) && !isExpanded(scenarioRunId)}
              >
                <CopilotKit
                  headers={{
                    "X-Auth-Token": project?.apiKey ?? "",
                  }}
                  runtimeUrl="/api/copilotkit"
                >
                  <CopilotKitWrapper
                    scenarioRunId={scenarioRunId}
                    isExpanded={isExpanded(scenarioRunId)}
                    onExpandToggle={() => handleExpandToggle(scenarioRunId)}
                  />
                </CopilotKit>
              </Box>
            ))}
          </Grid>
        </Box>
      </PageLayout.Container>
    </DashboardLayout>
  );
}

function CopilotKitWrapper({
  scenarioRunId,
  isExpanded,
  onExpandToggle,
}: {
  scenarioRunId: string;
  isExpanded: boolean;
  onExpandToggle: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const [status, setStatus] = useState<ScenarioRunStatus>(
    ScenarioRunStatus.IN_PROGRESS
  );

  const { setMessages } = useCopilotChat({
    headers: {
      "X-Auth-Token": project?.apiKey ?? "",
    },
  });

  // Fetch scenario state for this thread
  const { data: scenarioState } = useFetchScenarioState({
    scenarioRunId,
    options: {
      refreshInterval: status === ScenarioRunStatus.IN_PROGRESS ? 1000 : 0,
    },
  });

  useEffect(() => {
    if (scenarioState?.state?.messages) {
      setMessages(
        scenarioState.state.messages.map((message) => new TextMessage(message))
      );
    }

    if (scenarioState?.state?.status) {
      setStatus(scenarioState.state.status as ScenarioRunStatus);
    }
  }, [scenarioState]);

  return (
    <SimulationCard
      title={`Simulation ${scenarioRunId}`}
      status={status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
    >
      <CopilotChat Input={() => <div></div>} />
    </SimulationCard>
  );
}
