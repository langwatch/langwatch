import React, { useState } from "react";
import {
  Box,
  Button,
  HStack,
  Text,
  VStack,
  Badge,
  Flex,
  Spinner,
} from "@chakra-ui/react";
import { ArrowLeft, Clock, Check, X } from "react-feather";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../../simulations.css";
import {
  CustomCopilotKitChat,
  SimulationChatFadeOverlay,
  SimulationConsole,
} from "~/components/simulations";
import { useSimulationRouter } from "~/hooks/simulations";
import { api } from "~/utils/api";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { SimulationLayout } from "~/components/simulations/SimulationLayout";

// Previous Runs List Component
function PreviousRunsList({ scenarioId }: { scenarioId?: string }) {
  const { project } = useOrganizationTeamProject();
  const { goToSimulationRun, scenarioSetId, batchRunId } =
    useSimulationRouter();

  const { data: scenarioRunData, isLoading } =
    api.scenarios.getRunDataByScenarioId.useQuery(
      {
        projectId: project?.id ?? "",
        scenarioId: scenarioId ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioId,
      }
    );

  return (
    <VStack gap={3} align="stretch">
      {scenarioRunData?.data?.map((run, index) => (
        <Box
          key={run.scenarioRunId}
          p={4}
          borderRadius="md"
          border="1px solid"
          borderColor="gray.200"
          cursor="pointer"
          _hover={{ bg: "gray.100" }}
          onClick={() => {
            if (scenarioSetId && batchRunId) {
              goToSimulationRun({
                scenarioSetId,
                batchRunId,
                scenarioRunId: run.scenarioRunId,
              });
            }
          }}
        >
          <VStack align="start" gap={3} w="100%">
            {/* Status Badge and Timestamp Row */}
            <Flex
              align="start"
              w="100%"
              flexWrap="wrap"
              gap={2}
              alignItems="center"
            >
              {run.status === "SUCCESS" && <Check size={12} />}
              <Badge
                colorScheme={run.status === "SUCCESS" ? "green" : "orange"}
                variant="subtle"
                display="flex"
                alignItems="center"
                gap={1}
                px={2}
                py={1}
                borderRadius="md"
              >
                <Text fontSize="xs" fontWeight="medium">
                  {run.status === "SUCCESS" ? "completed" : "running"}
                </Text>
              </Badge>
            </Flex>

            {/* Metrics Row */}
            <VStack align="start" gap={1} w="100%">
              <Text fontSize="xs" color="gray.600">
                <Text>Duration: {Math.round(run.durationInMs / 1000)}s</Text>
                <Text>
                  Accuracy:{" "}
                  {run.results?.metCriteria?.length &&
                  run.results?.unmetCriteria?.length
                    ? (run.results?.metCriteria?.length /
                        (run.results?.metCriteria?.length +
                          run.results?.unmetCriteria?.length)) *
                      100
                    : 0}
                  %
                </Text>
              </Text>
              <Text fontSize="xs" color="gray.400" whiteSpace="nowrap">
                {new Date(run.timestamp).toLocaleDateString()},{" "}
                {new Date(run.timestamp).toLocaleTimeString()}
              </Text>
            </VStack>
          </VStack>
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
export default function IndividualScenarioRunPage() {
  const [showPreviousRuns, setShowPreviousRuns] = useState(false);
  const { goToSimulationSet, scenarioRunId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { scenarioSetId } = useSimulationRouter();
  // Fetch scenario run data using the correct API
  const { data: scenarioState, isLoading: isScenarioStateLoading } =
    api.scenarios.getRunState.useQuery(
      {
        scenarioRunId: scenarioRunId ?? "",
        projectId: project?.id ?? "",
      },
      {
        enabled: !!project?.id && !!scenarioRunId,
        refetchInterval: 1000,
      }
    );

  const results = scenarioState?.results;
  const scenarioId = scenarioState?.scenarioId;

  if (!scenarioRunId) {
    return null;
  }

  return (
    <SimulationLayout>
      <PageLayout.Container
        w="full"
        padding={6}
        marginTop={0}
        height="full"
        position="absolute"
        overflow="hidden"
        margin="auto"
        maxW="100%"
      >
        <VStack height="full" w="full">
          {/* Header with Back Button and Title */}
          <Box borderBottom="1px" borderColor="gray.200" w="100%" mb={2}>
            <HStack justify="space-between" align="center">
              <VStack>
                <Button
                  variant="ghost"
                  size="sm"
                  margin={0}
                  onClick={() => {
                    if (scenarioSetId) {
                      goToSimulationSet(scenarioSetId);
                    }
                  }}
                >
                  <ArrowLeft size={14} />
                  <Text>Back to Grid View</Text>
                </Button>
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
          {/* Single Card Container */}
          <Box
            bg="white"
            borderRadius="lg"
            boxShadow="sm"
            border="1px"
            borderColor="gray.200"
            overflow="hidden"
            w="full"
          >
            <VStack gap={0} height="100%" w="full">
              {/* Content Area */}
              <HStack align="start" gap={0} flex="1" w="100%" overflow="hidden">
                {/* Main Content Area */}
                <VStack
                  gap={0}
                  height="100%"
                  flex="1"
                  w={showPreviousRuns ? "calc(100% - 320px)" : "100%"}
                  transition="width 0.2s"
                  overflow="hidden"
                >
                  {/* Header with Back Button and Title */}
                  <Box p={6} borderBottom="1px" borderColor="gray.200" w="100%">
                    <HStack justify="space-between" align="center">
                      <VStack gap={4}>
                        <VStack align="space-between" gap={0}>
                          <HStack>
                            {scenarioState?.status === "SUCCESS" ? (
                              <Check size={12} color="green" />
                            ) : scenarioState?.status === "FAILED" ? (
                              <X size={12} color="red" />
                            ) : (
                              <Clock size={12} color="orange" />
                            )}
                            <Text fontSize="lg" fontWeight="semibold">
                              {scenarioState?.name}
                            </Text>
                          </HStack>
                          <Text fontSize="sm" color="gray.500" ml={5}>
                            ID: {scenarioId}
                          </Text>
                        </VStack>
                      </VStack>
                    </HStack>
                  </Box>
                  {/* Conversation Area - Scrollable */}
                  <Box w="100%" p={6} overflow="auto" maxHeight="100%">
                    <VStack>
                      <CustomCopilotKitChat
                        messages={scenarioState?.messages ?? []}
                      />
                      {/* Console Area */}
                      <Box
                        w="100%"
                        p={6}
                        pt={0}
                        borderTop="1px"
                        borderColor="gray.100"
                        flex="1"
                      >
                        <SimulationConsole
                          results={results}
                          scenarioName={scenarioState?.name ?? undefined}
                          status={scenarioState?.status}
                          durationInMs={scenarioState?.durationInMs}
                        />
                      </Box>
                    </VStack>
                  </Box>
                </VStack>

                {/* Previous Runs Sidebar - Scrollable */}
                {showPreviousRuns && (
                  <Box
                    w="250px"
                    height="100%"
                    borderLeft="1px"
                    borderColor="gray.200"
                    borderStyle="solid"
                    borderTopRightRadius="lg"
                    borderBottomRightRadius="lg"
                    overflow="hidden"
                    display="flex"
                    flexDirection="column"
                  >
                    <Box
                      p={6}
                      borderBottom="1px"
                      borderColor="gray.200"
                      borderStyle="solid"
                    >
                      <Text fontSize="md" fontWeight="semibold">
                        Previous Runs
                      </Text>
                    </Box>
                    <Box flex="1" overflow="auto" p={4} pt={3}>
                      <PreviousRunsList scenarioId={scenarioId} />
                    </Box>
                  </Box>
                )}
              </HStack>
            </VStack>
          </Box>
        </VStack>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
