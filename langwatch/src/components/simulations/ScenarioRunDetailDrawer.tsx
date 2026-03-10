import "@copilotkit/react-ui/styles.css";
import "~/pages/[project]/simulations/simulations.css";
import {
  Box,
  Button,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "~/components/CopyButton";
import { MetadataTag } from "~/components/MetadataTag";
import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useDrawerRunCallbacks } from "~/hooks/useDrawerRunCallbacks";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { useScenarioTarget } from "~/hooks/useScenarioTarget";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { TraceDetails } from "../traces/TraceDetails";
import { Drawer } from "../ui/drawer";
import { ConversationArea } from "./ConversationArea";
import { ScenarioRunActions } from "./ScenarioRunActions";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";
import { SimulationConsole } from "./simulation-console/SimulationConsole";

export interface ScenarioRunDetailDrawerProps {
  open?: boolean;
}

function formatResultsForCopy(results: unknown): string {
  return JSON.stringify(results, null, 2);
}

function hasNoResults(status?: ScenarioRunStatus): boolean {
  return (
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING ||
    status === ScenarioRunStatus.STALLED ||
    status === ScenarioRunStatus.CANCELLED
  );
}

function computeSuccessRate(met: number, unmet: number): string {
  const total = met + unmet;
  return total > 0 ? ((met / total) * 100).toFixed(1) : "0.0";
}

export function ScenarioRunDetailDrawer({
  open,
}: ScenarioRunDetailDrawerProps) {
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const { project } = useOrganizationTeamProject();
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [traceDrawerTraceId, setTraceDrawerTraceId] = useState<string | null>(null);
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);

  const scenarioRunId = params.scenarioRunId;

  const { data: scenarioState, error: runStateError } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId && !!open,
    },
  );

  const scenarioId = scenarioState?.scenarioId;
  const batchRunId = scenarioState?.batchRunId;

  const { data: scenarioData } =
    api.scenarios.getByIdIncludingArchived.useQuery(
      { projectId: project?.id ?? "", id: scenarioId ?? "" },
      { enabled: !!project?.id && !!scenarioId },
    );

  const targetNameMap = useTargetNameMap();

  // Resolve display title with target name
  const displayTitle = useMemo(() => {
    const targetRefId = scenarioState?.metadata?.langwatch?.targetReferenceId;
    const targetName = targetRefId
      ? (targetNameMap.get(targetRefId) ?? null)
      : null;
    return buildDisplayTitle({
      scenarioName: scenarioState?.name ?? "",
      targetName,
      iteration: undefined,
    });
  }, [scenarioState?.name, scenarioState?.metadata, targetNameMap]);

  const { onRunComplete, onRunFailed } = useDrawerRunCallbacks();

  const { runScenario, isRunning } = useRunScenario({
    projectId: project?.id,
    projectSlug: project?.slug,
    onRunComplete,
    onRunFailed,
  });

  const {
    target: persistedTarget,
    setTarget: persistTarget,
    hasPersistedTarget,
  } = useScenarioTarget(scenarioId);

  const handleRunAgain = useCallback(
    async (target: TargetValue, remember: boolean) => {
      if (!scenarioId || !target) return;
      if (remember) persistTarget(target);
      try {
        await runScenario({ scenarioId, target });
      } catch (error) {
        console.error("Failed to run scenario:", error);
      }
      setRunModalOpen(false);
    },
    [scenarioId, persistTarget, runScenario],
  );

  const handleRunAgainClick = useCallback(() => {
    if (hasPersistedTarget && persistedTarget) {
      void handleRunAgain(persistedTarget, true);
    } else {
      setRunModalOpen(true);
    }
  }, [hasPersistedTarget, persistedTarget, handleRunAgain]);

  // Get the first traceId from scenario messages to open trace details drawer
  const firstTraceId = useMemo(() => {
    const messages = scenarioState?.messages ?? [];
    for (const msg of messages) {
      if (msg.trace_id) return msg.trace_id;
    }
    return undefined;
  }, [scenarioState?.messages]);

  // Relative time that auto-updates every 30s while the drawer is open
  const [timeAgo, setTimeAgo] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!open || !scenarioState?.timestamp) {
      setTimeAgo(undefined);
      return;
    }
    const update = () => setTimeAgo(formatTimeAgo(scenarioState.timestamp));
    update();
    const interval = setInterval(update, 30_000);
    return () => clearInterval(interval);
  }, [open, scenarioState?.timestamp]);

  const suiteId = scenarioState?.metadata?.langwatch?.simulationSuiteId;

  const copyableIds = useMemo(() => {
    if (!scenarioId || !batchRunId || !scenarioRunId) return undefined;
    return [
      { label: "Scenario ID", value: scenarioId },
      { label: "Batch Run ID", value: batchRunId },
      { label: "Run ID", value: scenarioRunId },
      ...(suiteId ? [{ label: "Suite ID", value: suiteId }] : []),
    ];
  }, [scenarioId, batchRunId, scenarioRunId, suiteId]);

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => closeDrawer()}
        placement="end"
        size="lg"
      >
        <Drawer.Content paddingX={0} maxWidth="720px" overflow="hidden">
          {!scenarioState && open && (
            <Drawer.Body>
              {runStateError ? (
                runStateError.data?.code === "NOT_FOUND" ? (
                  <VStack gap={2} align="start" w="100%" pt={4}>
                    <Drawer.CloseTrigger />
                    <Heading size="md">Run is queued</Heading>
                    <Text color="fg.muted" fontSize="sm">This run is waiting to start. Check back shortly.</Text>
                  </VStack>
                ) : (
                  <VStack gap={2} align="start" w="100%" pt={4}>
                    <Drawer.CloseTrigger />
                    <Heading size="md" color="red.500">Failed to load run</Heading>
                    <Text color="fg.muted" fontSize="sm">{runStateError.message}</Text>
                  </VStack>
                )
              ) : (
                <VStack gap={4} align="start" w="100%" pt={4}>
                  <Skeleton height="32px" width="60%" />
                  <Skeleton height="24px" width="40%" />
                  <Skeleton height="200px" width="100%" borderRadius="md" />
                </VStack>
              )}
            </Drawer.Body>
          )}
          {scenarioState && (
            <VStack gap={0} h="100%" w="100%">
              {/* Sticky header — matches trace details pattern */}
              <VStack
                w="100%"
                gap={0}
                position="sticky"
                top={0}
                zIndex={2}
                background="bg.panel/75"
                backdropFilter="blur(8px)"
                borderTopRadius="lg"
              >
                <HStack
                  w="100%"
                  paddingTop={2}
                  paddingBottom={4}
                  paddingLeft={6}
                  paddingRight={12}
                  justify="space-between"
                >
                  <HStack gap={3}>
                    <ScenarioRunStatusIcon status={scenarioState.status} />
                    <Heading size="md">{displayTitle}</Heading>
                  </HStack>
                  <HStack gap={2}>
                    <ScenarioRunActions
                      scenario={scenarioData}
                      isRunning={isRunning}
                      onRunAgain={handleRunAgainClick}
                      onEditScenario={() => setScenarioEditorOpen(true)}
                    />
                    {firstTraceId && (
                      <Button
                        colorPalette="gray"
                        size="sm"
                        onClick={() => setTraceDrawerTraceId(firstTraceId)}
                      >
                        <ExternalLink size={14} />
                        Open Thread
                      </Button>
                    )}
                    <Drawer.CloseTrigger />
                  </HStack>
                </HStack>

                {/* Metrics summary — trace details style */}
                {scenarioState.results && !hasNoResults(scenarioState.status) && (
                  <HStack
                    paddingX={4}
                    borderBottomWidth={1}
                    borderColor="border.emphasized"
                    w="100%"
                    align="stretch"
                    gap={4}
                  >
                    <VStack
                      borderRightWidth="1px"
                      borderRightColor="border"
                      alignItems="flex-start"
                      paddingRight={4}
                      paddingLeft={4}
                      paddingY={3}
                    >
                      <b>Success Criteria</b>
                      <Text color="fg">
                        {scenarioState.results.metCriteria?.length ?? 0}/
                        {(scenarioState.results.metCriteria?.length ?? 0) +
                          (scenarioState.results.unmetCriteria?.length ?? 0)}
                      </Text>
                    </VStack>
                    <VStack
                      borderRightWidth="1px"
                      borderRightColor="border"
                      alignItems="flex-start"
                      paddingRight={4}
                      paddingY={3}
                    >
                      <b>Success Rate</b>
                      <Text color="fg">
                        {computeSuccessRate(
                          scenarioState.results.metCriteria?.length ?? 0,
                          scenarioState.results.unmetCriteria?.length ?? 0,
                        )}%
                      </Text>
                    </VStack>
                    {scenarioState.durationInMs && (
                      <VStack
                        borderRightWidth="1px"
                        borderRightColor="border"
                        alignItems="flex-start"
                        paddingRight={4}
                        paddingY={3}
                      >
                        <b>Duration</b>
                        <Text color="fg">
                          {(scenarioState.durationInMs / 1000).toFixed(2)}s
                        </Text>
                      </VStack>
                    )}
                    {timeAgo && (
                      <VStack
                        alignItems="flex-start"
                        paddingRight={4}
                        paddingY={3}
                      >
                        <b>Ran</b>
                        <Text color="fg">{timeAgo}</Text>
                      </VStack>
                    )}
                  </HStack>
                )}

                {/* Copyable IDs — MetadataTag chips (same as trace details) */}
                {copyableIds && (
                  <HStack
                    w="100%"
                    paddingX={6}
                    paddingY={3}
                    gap={3}
                    flexWrap="wrap"
                  >
                    {copyableIds.map((id) => (
                      <MetadataTag
                        key={id.label}
                        label={id.label}
                        value={id.value}
                        copyable
                      />
                    ))}
                  </HStack>
                )}
              </VStack>

              {/* Body — conversation on top, results on bottom */}
              <Drawer.Body
                paddingY={0}
                paddingX={0}
                overflowY="auto"
                display="flex"
                flexDirection="column"
                width="full"
              >
                {/* Conversation — shows thinking indicator when in progress */}
                <ConversationArea
                  messages={scenarioState.messages ?? []}
                  status={scenarioState.status}
                />

                {/* Results */}
                <Box
                  flex={1}
                  width="full"
                  borderTop={(scenarioState.messages ?? []).length > 0 ? "1px" : undefined}
                  borderColor="border.muted"
                  position="relative"
                  className="group"
                  css={{
                    "& > div:first-child": { borderRadius: 0, minHeight: "100%", height: "100%" },
                  }}
                >
                  <SimulationConsole
                    results={scenarioState.results}
                    scenarioName={scenarioState.name ?? undefined}
                    status={scenarioState.status}
                    durationInMs={scenarioState.durationInMs}
                  />
                  {scenarioState.results && (
                    <Box
                      position="absolute"
                      top={2}
                      right={2}
                      opacity={0}
                      _groupHover={{ opacity: 1 }}
                      transition="opacity 0.2s"
                    >
                      <CopyButton
                        value={formatResultsForCopy(
                          scenarioState.results,
                        )}
                        label="Results"
                      />
                    </Box>
                  )}
                </Box>
              </Drawer.Body>
            </VStack>
          )}
        </Drawer.Content>
      </Drawer.Root>

      <RunScenarioModal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        onRun={handleRunAgain}
        initialTarget={persistedTarget}
        isLoading={isRunning}
      />

      {/* Child drawer: Scenario Editor — managed via local state */}
      <ScenarioFormDrawer
        open={scenarioEditorOpen}
        onClose={() => setScenarioEditorOpen(false)}
        scenarioId={scenarioId}
      />

      {/* Child drawer: Trace Details — managed via local state */}
      <Drawer.Root
        open={!!traceDrawerTraceId}
        onOpenChange={() => setTraceDrawerTraceId(null)}
        placement="end"
        size="xl"
        modal={true}
      >
        <Drawer.Content paddingX={0} maxWidth="70%">
          <Drawer.CloseTrigger zIndex={10} />
          <Drawer.Body paddingY={0} paddingX={0} overflowY="auto">
            {traceDrawerTraceId && (
              <TraceDetails
                traceId={traceDrawerTraceId}
                selectedTab="messages"
                showMessages
              />
            )}
          </Drawer.Body>
        </Drawer.Content>
      </Drawer.Root>
    </>
  );
}
