import {
  Accordion,
  Box,
  Heading,
  HStack,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CopyButton } from "~/components/CopyButton";
import { ConversationExpandContext } from "~/features/traces-v2/components/TraceDrawer/conversationView/expandContext";
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
import { hasNoResults } from "./scenario-run-status.utils";
import { getRunStatePollInterval } from "./run-state-polling";
import { Drawer } from "../ui/drawer";
import { CopyIdChip } from "./CopyIdChip";
import { RunCriteriaChip } from "./RunCriteriaChip";
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

  // Long messages truncate by default; this seeds every bubble's expand
  // state via the shared conversation-expand context (Traces V2 mechanism).
  const [expandAllMessages, setExpandAllMessages] = useState(false);

  return (
    <>
      <Drawer.Root
        open={!!open}
        onOpenChange={() => closeDrawer()}
        placement="end"
        size="lg"
      >
        {/* Transparent at the Content level so the header band below can run
            its own translucent + backdrop-blur fill over the drawer's
            scrolling content — same recipe as the Traces V2 drawer shell. */}
        <Drawer.Content
          bg="transparent"
          paddingX={0}
          maxWidth="720px"
          overflow="hidden"
          borderRadius="lg"
        >
          {!scenarioState && open && (
            <Drawer.Body bg={{ base: "bg.surface", _dark: "bg.panel" }}>
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
                bg={{ base: "bg.surface", _dark: "bg.panel" }}
              >
              {/* Sticky header — inside scroll container for correct sticky
                  behavior. Translucent fill + backdrop blur matches the
                  Traces V2 drawer header band. */}
              <VStack
                align="stretch"
                w="100%"
                gap={2}
                paddingX={4}
                paddingTop={3}
                paddingBottom={3}
                position="sticky"
                top={0}
                zIndex={2}
                background="bg.panel/70"
                backdropFilter="blur(20px) saturate(150%)"
                borderTopRadius="lg"
                borderBottomWidth="1px"
                borderColor="border"
              >
                <HStack
                  w="100%"
                  justify="space-between"
                  gap={2.5}
                  minWidth={0}
                  paddingEnd={8}
                >
                  <HStack gap={3} flex={1} minWidth={0}>
                    <ScenarioRunStatusIcon status={scenarioState.status} />
                    <Heading size="md" truncate title={displayTitle}>
                      {displayTitle}
                    </Heading>
                  </HStack>
                  <HStack gap={1} flexShrink={0}>
                    <ScenarioRunActions
                      scenario={scenarioData}
                      isRunning={isRunning}
                      onRunAgain={handleRunAgainClick}
                      onEditScenario={() => setScenarioEditorOpen(true)}
                      onOpenThread={
                        firstTraceId && !hasNoResults(scenarioState.status)
                          ? () => setTraceDrawerTraceId(firstTraceId)
                          : null
                      }
                      dejaViewHref={dejaView.href ?? null}
                    />
                    <Drawer.CloseTrigger />
                  </HStack>
                </HStack>

                {/* Chip strip — metrics + copyable ids, one visual language
                    with the Traces V2 drawer header */}
                <HStack w="100%" gap={1.5} flexWrap="wrap">
                  {scenarioState.results &&
                    !hasNoResults(scenarioState.status) && (
                      <RunCriteriaChip
                        metCriteria={scenarioState.results.metCriteria ?? []}
                        unmetCriteria={
                          scenarioState.results.unmetCriteria ?? []
                        }
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
                  {scenarioData?.archivedAt && (
                    <Chip value="Archived" tone="yellow" />
                  )}
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
                    actions={
                      <HStack
                        as="span"
                        role="button"
                        tabIndex={0}
                        gap={1}
                        color="fg.muted"
                        cursor="pointer"
                        _hover={{ color: "fg" }}
                        transition="color 0.12s ease"
                        onClick={() => setExpandAllMessages((v) => !v)}
                        onKeyDown={(e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            setExpandAllMessages((v) => !v);
                          }
                        }}
                        aria-label={
                          expandAllMessages
                            ? "Collapse all messages"
                            : "Expand all messages"
                        }
                      >
                        {expandAllMessages ? (
                          <ChevronsDownUp size={12} />
                        ) : (
                          <ChevronsUpDown size={12} />
                        )}
                        <Text textStyle="2xs" fontWeight="500">
                          {expandAllMessages ? "Collapse all" : "Expand all"}
                        </Text>
                      </HStack>
                    }
                  >
                    <ConversationExpandContext.Provider
                      value={{
                        isExpandable: true,
                        shouldExpandAll: expandAllMessages,
                      }}
                    >
                      <ScenarioMessageRenderer
                        messages={scenarioState.messages ?? []}
                        streamingMessages={streamingMessages}
                        variant="drawer"
                        projectId={project?.id ?? ""}
                      />
                    </ConversationExpandContext.Provider>
                  </RunDetailSection>
                )}

                <RunDetailSection
                  value="results"
                  title="Results"
                  count={criteria?.total}
                  isFirst={!hasConversation}
                >
                  <Box
                    position="relative"
                    className="group"
                    borderRadius="xl"
                    overflow="hidden"
                    borderWidth="1px"
                    borderColor="border.muted"
                    boxShadow="sm"
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
