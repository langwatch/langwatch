import { Box, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationChatViewer } from "~/components/simulations";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import { useFetchScenarioState } from "~/hooks/simulations";
import { SimulationResults } from "~/components/simulations/SimulationResults";

interface IndividuatlSetPageProps {
  scenarioRunId: string;
}

// Main layout for a single Simulation Set page
export function IndividuatlSetPage({ scenarioRunId }: IndividuatlSetPageProps) {
  const { back } = useSimulationRouter();

  const { data: scenarioState } = useFetchScenarioState({
    scenarioRunId,
  });

  return (
    <DashboardLayout position="relative">
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <Box mb={4}>
          <button onClick={() => back()}>
            <HStack>
              <ArrowLeft size={14} /> Back to Simulation Batch
            </HStack>
          </button>
        </Box>
        <PageLayout.Header>
          <VStack alignItems="flex-start">
            <PageLayout.Heading>Simulation</PageLayout.Heading>
            <Text fontSize="sm" color="gray.500" mt={1}>
              Scenario Run ID: {scenarioRunId}
            </Text>
          </VStack>
        </PageLayout.Header>
        <VStack alignItems="flex-start">
          <VStack>
            <HStack height="50vh">
              {scenarioState?.results ? (
                <Card.Root w="50%" h="100%" borderWidth={1}>
                  <Card.Body>
                    {scenarioState.results && (
                      <SimulationResults results={scenarioState.results} />
                    )}
                  </Card.Body>
                </Card.Root>
              ) : (
                <Text mt={4} color="gray.400" fontStyle="italic">
                  No results available for this scenario run.
                </Text>
              )}
              <Box w="50%" h="100%">
                <SimulationChatViewer
                  scenarioRunId={scenarioRunId}
                  isExpanded={true}
                  onExpandToggle={() => {}}
                />
              </Box>
            </HStack>
          </VStack>
        </VStack>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
