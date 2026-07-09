import {
  Accordion,
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
import { RunScenarioModal } from "~/components/scenarios/RunScenarioModal";
import { ScenarioFormDrawer } from "~/components/scenarios/ScenarioFormDrawer";
import type { TargetValue } from "~/components/scenarios/TargetSelector";
import { buildDisplayTitle } from "~/components/suites/run-history-transforms";
import { useDejaViewLink } from "~/hooks/useDejaViewLink";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useDrawerRunCallbacks } from "~/hooks/useDrawerRunCallbacks";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRunScenario } from "~/hooks/useRunScenario";
import { useScenarioTarget } from "~/hooks/useScenarioTarget";
import { useSimulationStreamingState } from "~/hooks/useSimulationStreamingState";
import { useSimulationUpdateListener } from "~/hooks/useSimulationUpdateListener";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import { api } from "~/utils/api";
import { formatTimeAgo } from "~/utils/formatTimeAgo";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";
import { TraceDetails } from "../traces/TraceDetails";
import { Link } from "../ui/link";
import { hasNoResults } from "./scenario-run-status.utils";
import { getRunStatePollInterval } from "./run-state-polling";
import { Drawer } from "../ui/drawer";
import { CopyIdChip } from "./CopyIdChip";
import { RunDetailSection } from "./RunDetailSection";
import { ScenarioMessageRenderer } from "./ScenarioMessageRenderer";
import { ScenarioRunActions } from "./ScenarioRunActions";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";
import { SimulationConsole } from "./simulation-console/SimulationConsole";

export interface ScenarioRunDetailDrawerProps {
  open?: boolean;
}

function formatResultsForCopy(results: unknown): string {
  return JSON.stringify(results, null, 2);
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
  const dejaView = useDejaViewLink({
    aggregateId: scenarioRunId,
    tenantId: project?.id,
  });

  const { streamingMessages, handleStreamingEvent, clearCompleted } =
    useSimulationStreamingState(scenarioRunId ?? undefined);

  // Live updates: matching SSE events selectively invalidate getRunState for
  // this run, and streaming deltas flow through the streaming state above.
  const { isConnected: sseConnected } = useSimulationUpdateListener({
    projectId: project?.id ?? "",
    enabled: !!project?.id && !!scenarioRunId && !!open,
    debounceMs: 300,
    filter: scenarioRunId ? { scenarioRunId } : undefined,
    onStreamingEvent: handleStreamingEvent,
  });

  const { data: scenarioState, error: runStateError } = api.scenarios.getRunState.useQuery(
    {
      scenarioRunId: scenarioRunId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!project?.id && !!scenarioRunId && !!open,
      // Finished runs never change — stop polling entirely. Live runs poll
      // fast only while the event stream is down.
      refetchInterval: (data) =>
        getRunStatePollInterval({ status: data?.status, sseConnected }),
    },
  );

  // Clear streaming messages once server data includes them
  useEffect(() => {
    if (scenarioState?.messages) {
      clearCompleted(
        scenarioState.messages
          .map((m: { id?: string }) => m.id)
          .filter((id): id is string => !!id),
      );
    }
  }, [scenarioState?.messages, clearCompleted]);

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
      { label: "Scenario", value: scenarioId },
      { label: "Batch", value: batchRunId },
      { label: "Run", value: scenarioRunId },
      ...(suiteId ? [{ label: "Run plan", value: suiteId }] : []),
    ];
  }, [scenarioId, batchRunId, scenarioRunId, suiteId]);

  const criteria = useMemo(() => {
    if (!scenarioState?.results) return null;
    const met = scenarioState.results.metCriteria?.length ?? 0;
    const unmet = scenarioState.results.unmetCriteria?.length ?? 0;
    return { met, total: met + unmet };
  }, [scenarioState?.results]);

  const hasConversation =
    (scenarioState?.messages ?? []).length > 0 ||
    (streamingMessages ?? []).length > 0;
  const conversationCount =
    (scenarioState?.messages ?? []).length || (streamingMessages ?? []).length;

  const [openSections, setOpenSections] = useState<string[]>([
    "conversation",
    "results",
  ]);

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => closeDrawer()}
        placement="end"
        size="lg"
      >
        <Drawer.Content bg="bg" paddingX={0} maxWidth="720px" overflow="hidden">
          {!scenarioState && open && (
            <Drawer.Body>
              {runStateError ? (
                runStateError.data?.code === "NOT_FOUND" ? (
                  <VStack gap={2} align="start" w="100%" pt={4}>
                    <Drawer.CloseTrigger />
                    <Heading size="md">Run details not available yet</Heading>
                    <Text color="fg.muted" fontSize="sm">This run may be queued, in progress, or recently cancelled. Details will appear once available.</Text>
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
              <Drawer.Body
                paddingY={0}
                paddingX={0}
                overflowY="auto"
                display="flex"
                flexDirection="column"
                width="full"
              >
              {/* Sticky header — inside scroll container for correct sticky behavior */}
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
                  <HStack gap={3} flex={1} minWidth={0}>
                    <ScenarioRunStatusIcon status={scenarioState.status} />
                    <Heading size="md" lineClamp={2}>
                      {displayTitle}
                    </Heading>
                  </HStack>
                  <HStack gap={2} flexShrink={0}>
                    <ScenarioRunActions
                      scenario={scenarioData}
                      isRunning={isRunning}
                      onRunAgain={handleRunAgainClick}
                      onEditScenario={() => setScenarioEditorOpen(true)}
                    />
                    {firstTraceId && !hasNoResults(scenarioState.status) && (
                      <Button
                        colorPalette="gray"
                        size="sm"
                        onClick={() => setTraceDrawerTraceId(firstTraceId)}
                      >
                        <ExternalLink size={14} />
                        Open Thread
                      </Button>
                    )}
                    {dejaView.href && (
                      <Link href={dejaView.href}>
                        <Button colorPalette="gray" size="sm">
                          DejaView
                        </Button>
                      </Link>
                    )}
                    <Drawer.CloseTrigger />
                  </HStack>
                </HStack>

                {/* Chip strip — metrics + copyable ids, one visual language
                    with the Traces V2 drawer header */}
                <HStack
                  w="100%"
                  paddingX={6}
                  paddingBottom={3}
                  gap={1.5}
                  flexWrap="wrap"
                >
                  {criteria &&
                    criteria.total > 0 &&
                    !hasNoResults(scenarioState.status) && (
                      <Chip
                        label="Criteria"
                        value={`${criteria.met}/${criteria.total}`}
                        tone={criteria.met === criteria.total ? "green" : "red"}
                        tooltip={`${computeSuccessRate(
                          criteria.met,
                          criteria.total - criteria.met,
                        )}% of success criteria met`}
                      />
                    )}
                  {scenarioState.durationInMs > 0 && (
                    <Chip
                      label="Duration"
                      value={formatLatency(scenarioState.durationInMs)}
                    />
                  )}
                  {scenarioState.totalCost != null && (
                    <Chip
                      label="Cost"
                      value={formatCost(scenarioState.totalCost)}
                    />
                  )}
                  {timeAgo && <Chip label="Ran" value={timeAgo} />}
                  {copyableIds?.map((id) => (
                    <CopyIdChip
                      key={id.label}
                      label={id.label}
                      value={id.value}
                    />
                  ))}
                </HStack>
              </VStack>

              {/* Body — accordion sections, Traces V2 drawer language */}
              <Accordion.Root
                multiple
                value={openSections}
                onValueChange={(e) => setOpenSections(e.value)}
              >
                {/* Conversation — hidden when empty (e.g. stalled runs) */}
                {hasConversation && (
                  <RunDetailSection
                    value="conversation"
                    title="Conversation"
                    count={conversationCount}
                    isFirst
                  >
                    <Box
                      background="bg.muted"
                      borderRadius="lg"
                      overflow="hidden"
                      padding={4}
                    >
                      <ScenarioMessageRenderer
                        messages={scenarioState.messages ?? []}
                        streamingMessages={streamingMessages}
                        variant="drawer"
                        projectId={project?.id ?? ""}
                      />
                    </Box>
                  </RunDetailSection>
                )}

                <RunDetailSection
                  value="results"
                  title="Results"
                  count={criteria?.total}
                  isFirst={!hasConversation}
                  contentPadding={false}
                >
                  <Box position="relative" className="group">
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
                          value={formatResultsForCopy(scenarioState.results)}
                          label="Results"
                        />
                      </Box>
                    )}
                  </Box>
                </RunDetailSection>
              </Accordion.Root>
              </Drawer.Body>
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
        <Drawer.Content bg="bg" paddingX={0} maxWidth="70%">
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
