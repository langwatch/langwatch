import { Box, Button, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import "@copilotkit/react-ui/styles.css";
import "../simulations.css";
import { SimulationChatViewer } from "~/components/simulations";
import {
  useFetchScenarioResultsHistory,
  useSimulationRouter,
  useFetchScenarioRunData,
} from "~/hooks/simulations";
import {
  SimulationResults,
  SimulationHistoryTable,
} from "~/components/simulations";
import { useEffect, useState } from "react";

interface IndividuatlSetPageProps {
  scenarioRunId: string;
}

// Main layout for a single Simulation Set page
export function IndividuatlSetPage({ scenarioRunId }: IndividuatlSetPageProps) {
  const { goToSimulationBatch } = useSimulationRouter();
  const { data: scenarioState } = useFetchScenarioRunData({
    scenarioRunId,
  });
  const { data: scenarioResultsHistory } = useFetchScenarioResultsHistory({
    scenarioId: scenarioState?.scenarioId,
  });
  const results = scenarioState?.results;

  return (
    <DashboardLayout position="relative">
      <PageLayout.Container
        maxW={"calc(100vw - 200px)"}
        padding={6}
        marginTop={8}
      >
        <Box mb={4}>
          <Button
            p={0}
            onClick={() => goToSimulationBatch(scenarioState?.batchRunId ?? "")}
          >
            <HStack>
              <ArrowLeft size={14} /> Back to Simulation Batch
            </HStack>
          </Button>
        </Box>
        <PageLayout.Header>
          <VStack alignItems="flex-start">
            <PageLayout.Heading>Simulation</PageLayout.Heading>
            <Text fontSize="sm" color="gray.500" mt={1}>
              Scenario Run ID: {scenarioRunId}
            </Text>
          </VStack>
        </PageLayout.Header>
        <VStack alignItems="flex-start" w="100%">
          <VStack>
            <HStack height="50vh">
              <Box w="50%" h="100%">
                <SimulationChatViewer scenarioRunId={scenarioRunId} />
              </Box>
              {results ? (
                <Card.Root w="50%" borderWidth={1} alignSelf="flex-start">
                  <Card.Body>
                    <SimulationResults results={results} />
                  </Card.Body>
                </Card.Root>
              ) : (
                <Text mt={4} color="gray.400" fontStyle="italic">
                  No results available for this scenario run.
                </Text>
              )}
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
