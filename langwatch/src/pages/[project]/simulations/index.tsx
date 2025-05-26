import { Grid, Box, Button } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationCard } from "~/components/simulations/simulation-card";
import { useEffect, useState } from "react";
import { CopilotKit, useCopilotChat } from "@copilotkit/react-core";
import { CopilotChat } from "@copilotkit/react-ui";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import "@copilotkit/react-ui/styles.css";

// Main layout for the Simulation Sets page
export default function SimulationSetsPage() {
  const { project } = useOrganizationTeamProject();
  const [expandedSimulationId, setExpandedSimulationId] = useState<
    string | null
  >(null);

  const isExpanded = (simulationId: string | null) =>
    expandedSimulationId === simulationId;

  const handleExpandToggle = (simulationId: string) => {
    setExpandedSimulationId(
      expandedSimulationId === simulationId ? null : simulationId
    );
  };

  return (
    <DashboardLayout position="relative">
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <PageLayout.Header>
          <PageLayout.Heading>Simulations</PageLayout.Heading>
        </PageLayout.Header>
        <Grid
          templateColumns={isExpanded(null) ? `repeat(3, 1fr)` : "auto"}
          gap={6}
        >
          {Array.from({ length: 10 }).map((_, index) => (
            <Box
              key={index}
              width="full"
              hidden={!isExpanded(null) && !isExpanded(index.toString())}
            >
              <SimulationCard
                title={`Simulation ${index + 1}`}
                status="completed"
                onExpandToggle={() => handleExpandToggle(index.toString())}
                isExpanded={isExpanded(index.toString())}
              >
                <CopilotKit
                  headers={{
                    "X-Auth-Token": project?.apiKey ?? "",
                  }}
                  runtimeUrl="/api/copilotkit"
                  agent="scenario-agent"
                  threadId={`thread-${index}`}
                >
                  <CopilotKitWrapper />
                </CopilotKit>
              </SimulationCard>
            </Box>
          ))}
        </Grid>
      </PageLayout.Container>
    </DashboardLayout>
  );
}

function CopilotKitWrapper() {
  const { project } = useOrganizationTeamProject();

  const { reloadMessages, appendMessage } = useCopilotChat({
    headers: {
      "X-Auth-Token": project?.apiKey ?? "",
    },
  });

  return (
    <>
      <CopilotChat Input={() => <div></div>} />
      <Button
        onClick={async () => {
          // Hack to just get the new messages from the Copilot runtime
          const res2 = await appendMessage(
            new TextMessage({
              role: Role.System,
              content: "Refetching messages",
            })
          );
        }}
      >
        Reload
      </Button>
    </>
  );
}
