import { Box, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationChatViewer } from "~/components/simulations";
import {
  useFetchScenarioResultsHistory,
  useSimulationRouter,
  useFetchScenarioState,
} from "~/hooks/simulations";
import {
  SimulationResults,
  SimulationHistoryTable,
} from "~/components/simulations";
import { useEffect, useMemo, useState } from "react";

interface IndividuatlSetPageProps {
  scenarioRunId: string;
}

// Main layout for a single Simulation Set page
export function IndividuatlSetPage({ scenarioRunId }: IndividuatlSetPageProps) {
  const { back } = useSimulationRouter();
  const [currentScenarioId, setCurrentScenarioId] = useState<string | null>(
    null
  );

  const { data: scenarioState } = useFetchScenarioState({
    scenarioRunId,
  });
  const scenarioId = scenarioState?.scenarioId ?? "";

  const { data: scenarioResultsHistory } = useFetchScenarioResultsHistory({
    scenarioId,
  });

  console.log(scenarioState, scenarioId, scenarioResultsHistory);
  /**
   * Set the current scenario id when the scenario results history is loaded (once)
   */
  useEffect(() => {
    if (currentScenarioId) return;
    setCurrentScenarioId(scenarioId);
  }, [!!scenarioId]);

  const currentScenarioResults = useMemo(
    () =>
      scenarioResultsHistory?.history.find(
        (result) => result.scenarioId === currentScenarioId
      )?.results,
    [scenarioResultsHistory, currentScenarioId]
  );

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
              {currentScenarioResults ? (
                <Card.Root w="50%" h="100%" borderWidth={1}>
                  <Card.Body>
                    {currentScenarioResults && (
                      <SimulationResults results={currentScenarioResults} />
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
          <SimulationHistoryTable
            history={scenarioResultsHistory?.history ?? []}
          />
        </VStack>
      </PageLayout.Container>
    </DashboardLayout>
  );
}
