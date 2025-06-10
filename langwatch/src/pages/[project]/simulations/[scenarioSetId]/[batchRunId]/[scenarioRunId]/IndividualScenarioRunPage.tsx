import React, { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
  Drawer,
  Code,
} from "@chakra-ui/react";
import { ArrowLeft, Clock } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { DashboardLayout } from "~/components/DashboardLayout";
import "@copilotkit/react-ui/styles.css";
import "../../../simulations.css";
import { SimulationChatViewer } from "~/components/simulations";
import { useSimulationRouter } from "~/hooks/simulations";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useColorModeValue } from "~/components/ui/color-mode";
import { LayoutWithSetRunHistory } from "~/components/simulations/LayoutWithSetRunHistory";

interface IndividualScenarioRunPageProps {
  scenarioRunId: string;
}

// Console-like component for displaying test results
function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
}: {
  results?: any;
  scenarioName?: string;
  status?: string;
  durationInMs?: number;
}) {
  const consoleBg = useColorModeValue("gray.900", "gray.800");
  const consoleText = useColorModeValue("green.300", "green.300");

  const passed = status === "SUCCESS" ? 1 : 0;
  const failed = status === "SUCCESS" ? 0 : 1;
  const successRate = status === "SUCCESS" ? "100.0%" : "0.0%";
  const duration = durationInMs ? (durationInMs / 1000).toFixed(2) : "0.00";
  const agentTime = durationInMs
    ? ((durationInMs * 0.7) / 1000).toFixed(2)
    : "0.00"; // Mock agent time as 70% of total

  const consoleOutput = `=== Scenario Test Report ===
Total Scenarios: 1
Passed: ${passed}
Failed: ${failed}  
Success Rate: ${successRate}
1. ${scenarioName || "User is looking for a order cancellation request"} – ${
    status === "SUCCESS" ? "PASSED" : "FAILED"
  } in ${duration}s (agent: ${agentTime}s)
   Reasoning: ${
     results?.reasoning ||
     "The recipe provided is vegetarian, includes a list of ingredients, and has step-by-step cooking instructions."
   }
   Success Criteria: ${results?.metCriteria?.length || 1}/${
     (results?.metCriteria?.length || 1) + (results?.unmetCriteria?.length || 0)
   }`;

  return (
    <Box
      bg={consoleBg}
      color={consoleText}
      p={4}
      borderRadius="md"
      fontFamily="mono"
      fontSize="sm"
      minHeight="200px"
      overflow="auto"
    >
      <Code
        colorScheme="green"
        bg="transparent"
        color="inherit"
        whiteSpace="pre-wrap"
      >
        {consoleOutput}
      </Code>
    </Box>
  );
}

// Previous Runs Sidebar Component
function PreviousRunsSidebar({
  isOpen,
  onClose,
  scenarioId,
}: {
  isOpen: boolean;
  onClose: () => void;
  scenarioId?: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { goToSimulationRun } = useSimulationRouter();

  const { data: scenarioRunData } =
    api.scenarios.getRunDataByScenarioId.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioId: scenarioId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioId,
      }
    );

  if (!isOpen) return null;

  return (
    <VStack gap={3} align="stretch">
      {scenarioRunData?.data?.map((run, index) => (
        <Box
          key={run.scenarioRunId}
          p={3}
          bg="gray.50"
          borderRadius="md"
          cursor="pointer"
          _hover={{ bg: "gray.100" }}
          onClick={() => goToSimulationRun(run.scenarioRunId)}
        >
          <HStack justify="space-between">
            <VStack align="start" gap={1}>
              <Text fontWeight="medium" fontSize="sm">
                {run.status === "SUCCESS" ? "✅ completed" : "⏳ running"}
              </Text>
              <Text fontSize="xs" color="gray.600">
                {new Date(run.timestamp).toLocaleDateString()} •{" "}
                {Math.round(run.durationInMs / 1000)}s
              </Text>
              <Text fontSize="xs" color="gray.500">
                Accuracy: {run.status === "SUCCESS" ? "100.0%" : "0.0%"}
              </Text>
            </VStack>
            <Text fontSize="xs" color="gray.400">
              6/{index + 1}/2025, 9:21:36 AM
            </Text>
          </HStack>
        </Box>
      )) ?? (
        <Text color="gray.500" fontSize="sm">
          No previous runs found
        </Text>
      )}
    </VStack>
  );
}

// Main component
export function IndividualScenarioRunPage({
  scenarioRunId,
}: IndividualScenarioRunPageProps) {
  const [showPreviousRuns, setShowPreviousRuns] = useState(false);
  const { goToSimulationSet } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();

  // Fetch scenario run data using the correct API
  const { data: scenarioState } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId,
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id,
    }
  );

  const results = scenarioState?.results;
  const scenarioId = scenarioState?.scenarioId;

  return (
    <LayoutWithSetRunHistory>
      <PageLayout.Container
        maxW="100vw"
        padding={0}
        marginTop={0}
        height="100vh"
      >
        {/* Header with Back Button and Title */}
        <Box p={6} borderBottom="1px" borderColor="gray.200">
          <HStack justify="space-between" align="center">
            <VStack gap={4}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  goToSimulationSet(scenarioState?.batchRunId ?? "")
                }
              >
                <ArrowLeft size={14} />
                <Text>Back to Grid View</Text>
              </Button>

              <VStack align="start" gap={0}>
                <HStack>
                  <Text fontSize="lg" fontWeight="semibold">
                    {scenarioState?.name || "Order Cancellation Request"}
                  </Text>
                </HStack>
                <Text fontSize="sm" color="gray.500">
                  ID: {scenarioId ?? "scenario-001"}
                </Text>
              </VStack>
            </VStack>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowPreviousRuns((prev) => !prev)}
            >
              <Clock size={14} />
              Previous Runs
            </Button>
          </HStack>
        </Box>
        <HStack>
          <Box w="full">
            {/* Main Content Area */}
            <VStack gap={0} height="calc(100vh - 100px)">
              {/* Conversation Area */}
              <Box flex="1" w="100%" p={6}>
                <SimulationChatViewer
                  scenarioRunId={scenarioRunId}
                  isExpanded={true}
                />
              </Box>

              {/* Console Area */}
              <Box w="100%" p={6} pt={0}>
                <SimulationConsole
                  results={results}
                  scenarioName={scenarioState?.name}
                  status={scenarioState?.status}
                  durationInMs={scenarioState?.durationInMs}
                />
              </Box>
            </VStack>
          </Box>

          {/* Previous Runs Sidebar */}
          <PreviousRunsSidebar
            isOpen={showPreviousRuns}
            onClose={() => setShowPreviousRuns(false)}
            scenarioId={scenarioId}
          />
        </HStack>
      </PageLayout.Container>
    </LayoutWithSetRunHistory>
  );
}
