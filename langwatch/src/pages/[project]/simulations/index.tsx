import { Grid, Box, Button, HStack } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationCard } from "~/components/simulations/simulation-card";
import { useEffect, useState, useRef } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { TextMessage } from "@copilotkit/runtime-client-gql";
import { ZoomIn, ZoomOut } from "react-feather";
import "@copilotkit/react-ui/styles.css";
import useSWR from "swr";

// Main layout for the Simulation Sets page
export default function SimulationSetsPage() {
  const { project } = useOrganizationTeamProject();
  const [expandedSimulationId, setExpandedSimulationId] = useState<
    string | null
  >(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch all threads for the project
  const { data: threadsData } = useSWR<{ threads: string[] }>(
    project ? `/api/ag-ui/threads` : null,
    async () => {
      const res = await fetch("/api/ag-ui/threads", {
        headers: {
          "X-Auth-Token": project?.apiKey ?? "",
        },
      });
      return res.json();
    }
  );

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
            {threadsData?.threads.map((threadId) => (
              <Box
                key={threadId}
                width="full"
                hidden={!isExpanded(null) && !isExpanded(threadId)}
              >
                <CopilotKit
                  headers={{
                    "X-Auth-Token": project?.apiKey ?? "",
                  }}
                  runtimeUrl="/api/copilotkit"
                  agent="scenario-agent"
                  threadId={threadId}
                >
                  <CopilotKitWrapper
                    threadId={threadId}
                    isExpanded={isExpanded(threadId)}
                    onExpandToggle={() => handleExpandToggle(threadId)}
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
  threadId,
  isExpanded,
  onExpandToggle,
}: {
  threadId: string;
  isExpanded: boolean;
  onExpandToggle: () => void;
}) {
  const { project } = useOrganizationTeamProject();
  const [status, setStatus] = useState<"success" | "failure" | "in-progress">(
    "in-progress"
  );

  const { setMessages } = useCopilotChat({
    headers: {
      "X-Auth-Token": project?.apiKey ?? "",
    },
  });

  // Fetch scenario state for this thread
  const { data: scenarioState } = useSWR<{ state: any }>(
    project ? `/api/ag-ui/scenario-state/${threadId}` : null,
    async () => {
      const res = await fetch(`/api/ag-ui/scenario-state/${threadId}`, {
        headers: {
          "X-Auth-Token": project?.apiKey ?? "",
        },
      });
      return res.json();
    }
  );

  useEffect(() => {
    if (scenarioState?.state?.messages) {
      setMessages(
        scenarioState.state.messages.map((message) => new TextMessage(message))
      );
    }

    if (scenarioState?.state?.status) {
      setStatus(scenarioState.state.status);
    }
  }, [scenarioState]);

  return (
    <SimulationCard
      title={`Simulation ${threadId}`}
      status={status}
      onExpandToggle={onExpandToggle}
      isExpanded={isExpanded}
    >
      <CopilotChat Input={() => <div></div>} />
    </SimulationCard>
  );
}
