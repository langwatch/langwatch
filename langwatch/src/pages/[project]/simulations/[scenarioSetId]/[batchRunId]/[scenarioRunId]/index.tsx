import { Box, Button, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { ArrowLeft, Clock, Edit2, Play } from "lucide-react";
import { useRouter } from "next/router";
import React, { useCallback, useState } from "react";
import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import {
  CustomCopilotKitChat,
  PreviousRunsList,
  ScenarioRunHeader,
  SimulationConsole,
  SimulationLayout,
} from "~/components/simulations";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useDrawer } from "~/hooks/useDrawer";
import { useScenarioTarget } from "~/hooks/useScenarioTarget";
import "@copilotkit/react-ui/styles.css";
import "../../../simulations.css";
import { useSimulationRouter } from "~/hooks/simulations";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { pollForScenarioRun } from "~/utils/pollForScenarioRun";
import { buildRoutePath } from "~/utils/routes";

// Main component
export default function IndividualScenarioRunPage() {
  const router = useRouter();
  const [showPreviousRuns, setShowPreviousRuns] = useState(false);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const { goToSimulationBatchRuns, scenarioRunId } = useSimulationRouter();
  const { project } = useOrganizationTeamProject();
  const { scenarioSetId, batchRunId } = useSimulationRouter();
  const { openDrawer, drawerOpen } = useDrawer();
  const utils = api.useContext();
  const runMutation = api.scenarios.run.useMutation();
  // Fetch scenario run data using the correct API
  const { data: scenarioState } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId,
      refetchInterval: 1000,
    },
  );

  const results = scenarioState?.results;
  const scenarioId = scenarioState?.scenarioId;

  // Check if the scenario exists in our database
  const { data: scenarioExists } = api.scenarios.getById.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project?.id && !!scenarioId },
  );

  // Target selection persistence for "Run Again"
  const {
    target: persistedTarget,
    setTarget: persistTarget,
    hasPersistedTarget,
  } = useScenarioTarget(scenarioId);

  // Handle running the scenario again
  const handleRunAgain = useCallback(
    async (target: TargetValue, remember: boolean) => {
      if (!project?.id || !scenarioId || !target) return;

      if (remember) {
        persistTarget(target);
      }

      try {
        const { setId, batchRunId: newBatchRunId } =
          await runMutation.mutateAsync({
            projectId: project.id,
            scenarioId,
            target: { type: target.type, referenceId: target.id },
          });

        // Poll for the run to appear, then redirect
        const result = await pollForScenarioRun(
          utils.scenarios.getBatchRunData.fetch,
          {
            projectId: project.id,
            scenarioSetId: setId,
            batchRunId: newBatchRunId,
          },
        );

        if (result.success) {
          void router.push(
            buildRoutePath("simulations_run", {
              project: project.slug,
              scenarioSetId: setId,
              batchRunId: newBatchRunId,
              scenarioRunId: result.scenarioRunId,
            }),
          );
        }
      } catch (error) {
        console.error("Failed to run scenario:", error);
      }

      setRunModalOpen(false);
    },
    [project, scenarioId, persistTarget, runMutation, router, utils],
  );

  // Handle "Run Again" button click
  const handleRunAgainClick = useCallback(() => {
    if (hasPersistedTarget && persistedTarget) {
      // Run immediately with persisted target
      void handleRunAgain(persistedTarget, true);
    } else {
      // Show modal to select target
      setRunModalOpen(true);
    }
  }, [hasPersistedTarget, persistedTarget, handleRunAgain]);

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
              {scenarioSetId && batchRunId && (
                <VStack>
                  <Button
                    variant="ghost"
                    size="sm"
                    margin={0}
                    onClick={() => {
                      goToSimulationBatchRuns(scenarioSetId, batchRunId);
                    }}
                  >
                    <ArrowLeft size={14} />
                    <Text>View All</Text>
                  </Button>
                </VStack>
              )}

              <HStack gap={2}>
                {scenarioExists && (
                  <>
                    <Button
                      colorPalette="blue"
                      size="sm"
                      onClick={handleRunAgainClick}
                      loading={runMutation.isPending}
                    >
                      <Play size={14} />
                      Run Again
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        openDrawer("scenarioEditor", {
                          urlParams: { scenarioId: scenarioId ?? "" },
                        });
                      }}
                    >
                      <Edit2 size={14} />
                      Edit Scenario
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowPreviousRuns((prev) => !prev)}
                >
                  <Clock size={14} />
                  Previous Runs
                </Button>
              </HStack>
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
                    <ScenarioRunHeader
                      status={scenarioState?.status}
                      name={scenarioState?.name}
                      scenarioId={scenarioId}
                    />
                    {/* Conversation Area - Scrollable */}
                    <Box w="100%" p={4} overflow="auto" maxHeight="100%">
                      <VStack>
                        <CustomCopilotKitChat
                          messages={scenarioState?.messages ?? []}
                          hideInput
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

      <ScenarioFormDrawer open={drawerOpen("scenarioEditor")} />

      <RunScenarioModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        onRun={handleRunAgain}
        initialTarget={persistedTarget}
        isLoading={runMutation.isPending}
      />
    </SimulationLayout>
  );
}
