import { Text, Grid, Box } from "@chakra-ui/react";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import { SimulationCard } from "~/components/simulations/simulation-card";
import { useState } from "react";

// Main layout for the Simulation Sets page
export default function SimulationSetsPage() {
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
          templateColumns={isExpanded(null) ? "repeat(3, 1fr)" : "auto"}
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
                <Text>Simulation ${index + 1}</Text>
              </SimulationCard>
            </Box>
          ))}
        </Grid>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
