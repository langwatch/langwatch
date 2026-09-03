import { Accordion, Box, Button, Heading, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { ChevronsDownUp, ChevronsUpDown, Inbox } from "lucide-react";
import { lazy, Suspense, useCallback, useState } from "react";
import { CopyButton } from "@langwatch/workflow-web/components/CopyButton";
import { RunScenarioModal } from "../scenarios/run-scenario-modal";
import { ScenarioFormDrawer } from "../scenarios/scenario-form-drawer";
import { formatCost, formatLatency } from "@langwatch/design-system/metric-value-formatters";
import { HandledErrorAlert } from "../../../behavior/errors";
import { Chip } from "@langwatch/trace-web/explorer/components/TraceDrawer/Chip";
import { ConversationExpandContext } from "@langwatch/trace-web/explorer/components/TraceDrawer/conversationView/expandContext";
import { useDejaViewLink } from "@langwatch/workflow-web/hooks/useDejaViewLink";
import { useDrawer, useDrawerParams } from "@langwatch/ui-drawer";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project";
import { api } from "../../../behavior/scenario-api";
import { useRouter } from "../../../behavior/next-router";
import { Drawer } from "@langwatch/workflow-web/components/ui/drawer";
import { ScenarioMessageRenderer } from "./scenario-message-renderer";
import {
  CopyIdChip,
  RunCriteriaChip,
  RunDetailSection,
  ScenarioRunActions,
  ScenarioRunStatusIcon,
  SimulationConsole,
  hasNoResults,
} from "../../../index";
import { useRunAgainActions } from "./use-run-again-actions";
import { useRunDetailFacts } from "../../../behavior/simulations/use-run-detail-facts";
import { useRunStateStream } from "../../../behavior/simulations/use-run-state-stream";
import { isAgentTestScenarioId } from "@langwatch/scenario-contract";

/**
 * The Agent Testing variant: wider, side by side when the width allows, and
 * able to open on a run that has no id yet. Lazy so the classic drawer's
 * chunk does not grow for v1 readers.
 */
const AgentTestingRunDrawer = lazy(() =>
  import("../agent-testing/drawers/agent-testing-run-drawer").then((module) => ({
    default: module.AgentTestingRunDrawer,
  })),
);

export interface ScenarioRunDetailDrawerProps {
  open?: boolean;
}

function formatResultsForCopy(results: unknown): string {
  return JSON.stringify(results, null, 2);
}

/**
 * What a secret parameter shows in place of a value. There is no value to
 * show: the run records the name and nothing else.
 */
const SECRET_VALUE_MASK = "••••••••";

/**
 * Whole-conversation view in Trace Explorer: every trace of this run carries
 * the scenario.run_id attribute, so a scenarioRun:"<id>" search shows the
 * full conversation. Same #<lens>?q= fragment contract as the command bar's
 * trace links.
 */
function useOpenRunInTraces({
  projectSlug,
  scenarioRunId,
}: {
  projectSlug: string | undefined;
  scenarioRunId: string | undefined;
}) {
  const router = useRouter();

  return useCallback(() => {
    if (!projectSlug || !scenarioRunId) return;
    const query = encodeURIComponent(`scenarioRun:"${scenarioRunId}"`);
    void router.push(`/${projectSlug}/traces#all-traces?q=${query}`);
  }, [projectSlug, scenarioRunId, router]);
}

/**
 * Everything the run detail drawer knows about one run: the live state, the
 * streamed messages, the scenario record, and the actions on it. Shared by
 * the classic drawer and the Agent Testing variant so the two layouts read
 * the same run the same way.
 */
export function useScenarioRunDetail({
  scenarioRunId,
  open,
}: {
  scenarioRunId: string | undefined;
  open: boolean;
}) {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const [scenarioEditorOpen, setScenarioEditorOpen] = useState(false);

  const dejaView = useDejaViewLink({
    aggregateId: scenarioRunId,
    tenantId: project?.id,
  });

  const stream = useRunStateStream({
    scenarioRunId,
    projectId: project?.id,
    isOpen: open,
  });
  const scenarioId = stream.scenarioState?.scenarioId;
  const batchRunId = stream.scenarioState?.batchRunId;

  const { data: scenarioData } = api.scenarios.getByIdIncludingArchived.useQuery(
    { projectId: project?.id ?? "", id: scenarioId ?? "" },
    { enabled: !!project?.id && !!scenarioId },
  );

  const facts = useRunDetailFacts({
    scenarioState: stream.scenarioState,
    streamingMessages: stream.streamingMessages,
    scenarioRunId,
    isOpen: open,
  });
  const actions = useRunAgainActions({
    scenarioId,
    projectId: project?.id,
    projectSlug: project?.slug,
  });
  const handleOpenInTraces = useOpenRunInTraces({
    projectSlug: project?.slug,
    scenarioRunId,
  });

  return {
    project,
    openDrawer,
    scenarioId,
    batchRunId,
    scenarioData,
    dejaView,
    scenarioEditorOpen,
    setScenarioEditorOpen,
    handleOpenInTraces,
    ...stream,
    ...facts,
    ...actions,
  };
}

export type ScenarioRunDetail = ReturnType<typeof useScenarioRunDetail>;

export { formatResultsForCopy, SECRET_VALUE_MASK };

/**
 * The run detail drawer. The Agent Testing pages open the same registry key
 * with `variant: "agent-testing"`, which renders the wide variant; without it
 * the drawer renders exactly as v1 always has.
 */
export function ScenarioRunDetailDrawer(props: ScenarioRunDetailDrawerProps) {
  const params = useDrawerParams();
  if (params.variant === "agent-testing") {
    return (
      <Suspense fallback={null}>
        <AgentTestingRunDrawer open={props.open} />
      </Suspense>
    );
  }
  return <ClassicScenarioRunDetailDrawer {...props} />;
}

function ClassicScenarioRunDetailDrawer({ open }: ScenarioRunDetailDrawerProps) {
  const { closeDrawer } = useDrawer();
  const params = useDrawerParams();
  const scenarioRunId = params.scenarioRunId;

  const {
    project,
    openDrawer,
    scenarioState,
    runStateError,
    streamingMessages,
    scenarioId,
    scenarioData,
    displayTitle,
    isRunning,
    runModalOpen,
    setRunModalOpen,
    scenarioEditorOpen,
    setScenarioEditorOpen,
    persistedTarget,
    handleRunAgain,
    handleRunAgainClick,
    firstTraceId,
    handleOpenInTraces,
    dejaView,
    timeAgo,
    copyableIds,
    criteria,
    parameters,
    secretParameterNames,
    hasConversation,
    conversationCount,
    shouldShowNoResponse,
  } = useScenarioRunDetail({ scenarioRunId, open: !!open });

  const [openSections, setOpenSections] = useState<string[]>([
    "conversation",
    "no-response",
    "results",
    "parameters",
  ]);

  // Long messages truncate by default; this seeds every bubble's expand
  // state via the shared conversation-expand context (Traces V2 mechanism).
  const [expandAllMessages, setExpandAllMessages] = useState(false);

  return (
    <>
      <Drawer.Root
        open={!!open}
        // Only a close is a close; see AgentTestingRunDrawer.
        onOpenChange={({ open: isOpen }) => {
          if (!isOpen) closeDrawer();
        }}
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
                    <Text color="fg.muted" fontSize="sm">
                      This run may be queued, in progress, or recently cancelled. Details will
                      appear once available.
                    </Text>
                  </VStack>
                ) : (
                  // The alert is the whole error surface here: it reads the
                  // handled payload, an authored non-5xx message, or the
                  // generic unknown state, and carries the tips, docs link and
                  // copyable error id with it.
                  <VStack gap={2} align="start" w="100%" pt={4}>
                    <Drawer.CloseTrigger />
                    <Box width="100%">
                      <HandledErrorAlert error={runStateError} fallbackTitle="Failed to load run" />
                    </Box>
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
                <HStack w="100%" justify="space-between" gap={2.5} minWidth={0} paddingEnd={8}>
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
                          ? () =>
                              openDrawer("traceV2Details", {
                                traceId: firstTraceId,
                                // The thread IS the conversation view; landing
                                // on the drawer's default mode would show the
                                // reader spans when they asked for the thread.
                                mode: "conversation",
                              })
                          : null
                      }
                      onOpenInTraces={
                        firstTraceId && !hasNoResults(scenarioState.status)
                          ? handleOpenInTraces
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
                  {scenarioState.results && !hasNoResults(scenarioState.status) && (
                    <RunCriteriaChip
                      metCriteria={scenarioState.results.metCriteria ?? []}
                      unmetCriteria={scenarioState.results.unmetCriteria ?? []}
                    />
                  )}
                  {scenarioState.durationInMs > 0 && (
                    <Chip label="Duration" value={formatLatency(scenarioState.durationInMs)} />
                  )}
                  {scenarioState.totalCost != null && (
                    <Chip label="Cost" value={formatCost(scenarioState.totalCost)} />
                  )}
                  {timeAgo && <Chip label="Ran" value={timeAgo} />}
                  {scenarioData?.archivedAt && <Chip value="Archived" tone="yellow" />}
                  {copyableIds?.map((id) => (
                    <CopyIdChip key={id.label} label={id.label} value={id.value} />
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
                      <Button
                        size="2xs"
                        variant="ghost"
                        color="fg.muted"
                        _hover={{ color: "fg" }}
                        onClick={() => setExpandAllMessages((v) => !v)}
                        aria-label={
                          expandAllMessages ? "Collapse all messages" : "Expand all messages"
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
                      </Button>
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

                {/* No-response — explicit empty state when a finished run
                    produced no messages (agent under test returned nothing). */}
                {shouldShowNoResponse && (
                  <RunDetailSection value="no-response" title="Conversation" isFirst>
                    <VStack
                      align="center"
                      justify="center"
                      gap={2}
                      paddingY={8}
                      color="fg.muted"
                      data-testid="scenario-no-response"
                    >
                      <Inbox size={24} />
                      <Text fontSize="sm" fontWeight="medium" color="fg">
                        No response
                      </Text>
                      <Text fontSize="xs" textAlign="center" maxWidth="320px">
                        The agent under test didn&apos;t return any messages for this run.
                      </Text>
                    </VStack>
                  </RunDetailSection>
                )}

                <RunDetailSection
                  value="results"
                  title="Results"
                  count={criteria?.total}
                  isFirst={!hasConversation && !shouldShowNoResponse}
                >
                  <Box
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
                      titleBarActions={
                        scenarioState.results ? (
                          <CopyButton
                            value={formatResultsForCopy(scenarioState.results)}
                            label="Results"
                            size="2xs"
                            color="gray.500"
                            _hover={{ color: "gray.200", bg: "gray.800" }}
                          />
                        ) : undefined
                      }
                    />
                  </Box>
                </RunDetailSection>

                {parameters.length + secretParameterNames.length > 0 && (
                  <RunDetailSection
                    value="parameters"
                    title="Parameters"
                    count={parameters.length + secretParameterNames.length}
                  >
                    <VStack align="stretch" gap={1.5} data-testid="run-parameters">
                      {parameters.map(([name, value]) => (
                        <ParameterRow key={name} name={name} value={String(value)} />
                      ))}
                      {secretParameterNames.map((name) => (
                        <ParameterRow
                          key={name}
                          name={name}
                          value={SECRET_VALUE_MASK}
                          muted={true}
                        />
                      ))}
                    </VStack>
                  </RunDetailSection>
                )}
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

      {/* Child drawer: Scenario Editor, managed via local state. An agent
          test run has no scenario row, so the editor gets no id to read. */}
      <ScenarioFormDrawer
        open={scenarioEditorOpen}
        onClose={() => setScenarioEditorOpen(false)}
        scenarioId={scenarioId && isAgentTestScenarioId(scenarioId) ? undefined : scenarioId}
      />
    </>
  );
}

/** One name and what the run recorded for it. */
export function ParameterRow({
  name,
  value,
  muted = false,
}: {
  name: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <HStack gap={3} align="start">
      <Text fontSize="xs" fontFamily="mono" color="fg.muted" width="180px" flexShrink={0}>
        {name}
      </Text>
      <Text
        fontSize="xs"
        fontFamily="mono"
        wordBreak="break-word"
        color={muted ? "fg.subtle" : undefined}
      >
        {value}
      </Text>
    </HStack>
  );
}
