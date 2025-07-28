import { Box, Button, HStack, Text, VStack, Skeleton } from "@chakra-ui/react";
import React, { useState } from "react";
import { ArrowLeft, Clock, Check, X } from "react-feather";

import {
  CustomCopilotKitChat,
  SimulationConsole,
  PreviousRunsList,
  SimulationLayout,
} from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import "@copilotkit/react-ui/styles.css";
import "../../../simulations.css";
import { useSimulationRouter } from "~/hooks/simulations";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

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
              {!scenarioState && (
                <Box p={6} w="100%">
                  <VStack gap={4} align="start" w="100%">
                    <Skeleton height="32px" width="60%" />
                    <Skeleton height="24px" width="40%" />
                    <Skeleton height="200px" width="100%" borderRadius="md" />
                  </VStack>
                </Box>
              )}

              {scenarioState && (
                <HStack
                  align="start"
                  gap={0}
                  flex="1"
                  w="100%"
                  overflow="hidden"
                >
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
                    <Box
                      p={5}
                      borderBottom="1px"
                      borderColor="gray.200"
                      w="100%"
                    >
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
                              Scenario ID: {scenarioId}
                            </Text>
                          </VStack>
                        </VStack>
                      </HStack>
                    </Box>
                    {/* Conversation Area - Scrollable */}
                    <Box w="100%" p={4} overflow="auto" maxHeight="100%">
                      <VStack>
                        <CustomCopilotKitChat
                          messages={scenarioState?.messages ?? []}
                        />
                        {/* Console Area */}
                        <Box
                          w="100%"
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
              )}
            </VStack>
          </Box>
        </VStack>
      </PageLayout.Container>
    </SimulationLayout>
  );
}
