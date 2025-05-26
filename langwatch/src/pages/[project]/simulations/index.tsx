import { Grid, Box, Button, HStack } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationCard } from "~/components/simulations/simulation-card";
import { useEffect, useState, useRef } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import { ZoomIn, ZoomOut } from "react-feather";
import "@copilotkit/react-ui/styles.css";
import useSWR from "swr";
import type { Role } from "@ag-ui/core";

// Main layout for the Simulation Sets page
export default function SimulationSetsPage() {
  const { project } = useOrganizationTeamProject();
  const [expandedSimulationId, setExpandedSimulationId] = useState<
    string | null
  >(null);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

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
            {Array.from({ length: 10 }).map((_, index) => (
              <Box
                key={index}
                width="full"
                hidden={!isExpanded(null) && !isExpanded(index.toString())}
              >
                <CopilotKit
                  headers={{
                    "X-Auth-Token": project?.apiKey ?? "",
                  }}
                  runtimeUrl="/api/copilotkit"
                  agent="scenario-agent"
                  threadId={`thread-${index}`}
                >
                  <CopilotKitWrapper
                    threadId={`thread-${index}`}
                    isExpanded={isExpanded(index.toString())}
                    onExpandToggle={() => handleExpandToggle(index.toString())}
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

  const { data } = useSWR<{
    events: {
      threadId: string;
      type: string;
      messages?: { content: string; role: string }[];
      value?: {
        messages?: { content: string; role: string }[];
        status?: "success" | "failure";
      };
    }[];
  }>("/api/copilotkit", async () => {
    const res = await fetch("/api/copilotkit", {
      method: "GET",
      headers: {
        "X-Auth-Token": project?.apiKey ?? "",
      },
    });
    return res.json();
  });

  useEffect(() => {
    if (data) {
      const event = data.events
        .reverse()
        .find((event) => event.threadId === threadId);

      const messages = event?.messages ?? event?.value?.messages ?? [];
      const status = event?.value?.status;

      console.log({
        messages,
        data,
        threadId,
      });

      if (status) {
        setStatus(status ?? "in-progress");
      }

      if (messages) {
        console.log(messages);
        setMessages(
          messages.map(
            (message) =>
              new TextMessage({
                role: message.role as any,
                content: message.content,
              })
          )
        );
      }
    }
  }, [data]);

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
