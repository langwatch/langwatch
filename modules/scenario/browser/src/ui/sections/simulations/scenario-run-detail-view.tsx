/**
 * One run's detail: the identity band, the chip strip and the accordion
 * sections. The run detail drawer and the standalone run page both render it.
 */

import { Chip } from "@langwatch/design-system/chip";
import { ConversationExpandContext } from "@langwatch/design-system/conversation-expand-context";
import { formatCost, formatLatency } from "@langwatch/design-system/metric-value-formatters";
import {
  Accordion,
  Box,
  Button,
  Heading,
  HStack,
  Text,
  VStack,
} from "@langwatch/design-system/primitives";
import { isAgentTestScenarioId } from "@langwatch/scenario-contract";
import { ChevronsDownUp, ChevronsUpDown, Inbox } from "lucide-react";
import { type ReactNode, useState } from "react";

import type { ScenarioRunState } from "../../../behavior/simulations/use-run-state-stream.ts";
import { hasNoResults } from "../../../model/scenario-run-status.utils.ts";
import { CopyIdChip } from "../../elements/copy-id-chip.tsx";
import { CutAtLimitBadge, isCutAtLimitOf } from "../../elements/cut-at-limit-badge.tsx";
import { ParameterRow, SECRET_VALUE_MASK } from "../../elements/parameter-row.tsx";
import { RunCriteriaChip } from "../../elements/run-criteria-chip.tsx";
import { RunDetailSection } from "../../elements/run-detail-section.tsx";
import { ScenarioRunActions } from "../../elements/scenario-run-actions.tsx";
import { ScenarioRunStatusIcon } from "../../elements/scenario-run-status-icon.tsx";
import { SimulationConsole } from "../../elements/simulation-console/simulation-console.tsx";
import { isHumanCallerRun } from "../agent-testing/results/caller-display.ts";
import { RunScenarioModal } from "../scenarios/run-scenario-modal.tsx";
import { ScenarioFormDrawer } from "../scenarios/scenario-form-drawer.tsx";
import { CopyButton } from "../workflow/copy-button.tsx";
import { ScenarioMessageRenderer } from "./scenario-message-renderer.tsx";
import type { ScenarioRunDetail } from "./use-scenario-run-detail.ts";

function formatResultsForCopy(results: unknown): string {
  return JSON.stringify(results, null, 2);
}

function RunDetailChips({
  scenarioState,
  timeAgo,
  isArchived,
  copyableIds,
}: {
  scenarioState: ScenarioRunState;
  timeAgo: string | undefined;
  isArchived: boolean;
  copyableIds: readonly { label: string; value: string }[] | undefined;
}) {
  return (
    <HStack w="100%" gap={1.5} flexWrap="wrap">
      {scenarioState.results && !hasNoResults(scenarioState.status) && (
        <RunCriteriaChip
          metCriteria={scenarioState.results.metCriteria ?? []}
          unmetCriteria={scenarioState.results.unmetCriteria ?? []}
          inconclusiveCriteria={scenarioState.results.inconclusiveCriteria ?? []}
        />
      )}
      {scenarioState.durationInMs > 0 && (
        <Chip label="Duration" value={formatLatency(scenarioState.durationInMs)} />
      )}
      {scenarioState.totalCost != null && (
        <Chip label="Cost" value={formatCost(scenarioState.totalCost)} />
      )}
      {timeAgo && <Chip label="Ran" value={timeAgo} />}
      {isArchived && <Chip value="Archived" tone="yellow" />}
      {copyableIds?.map((id) => (
        <CopyIdChip key={id.label} label={id.label} value={id.value} />
      ))}
    </HStack>
  );
}

function ConversationExpandButton({
  expandAllMessages,
  onToggle,
}: {
  expandAllMessages: boolean;
  onToggle: () => void;
}) {
  return (
    <Button
      size="2xs"
      variant="ghost"
      color="fg.muted"
      _hover={{ color: "fg" }}
      onClick={onToggle}
      aria-label={expandAllMessages ? "Collapse all messages" : "Expand all messages"}
    >
      {expandAllMessages ? <ChevronsDownUp size={12} /> : <ChevronsUpDown size={12} />}
      <Text textStyle="2xs" fontWeight="500">
        {expandAllMessages ? "Collapse all" : "Expand all"}
      </Text>
    </Button>
  );
}

/** The run's band and sections; `headerEnd` closes the band (the drawer's close button). */
export function RunDetailView({
  detail,
  scenarioState,
  headerEnd,
}: {
  detail: ScenarioRunDetail;
  scenarioState: ScenarioRunState;
  headerEnd?: ReactNode;
}) {
  const {
    project,
    openDrawer,
    scenarioData,
    displayTitle,
    isRunning,
    setScenarioEditorOpen,
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
    streamingMessages,
  } = detail;

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
            {isCutAtLimitOf(scenarioState.metadata) ? <CutAtLimitBadge /> : null}
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
                firstTraceId && !hasNoResults(scenarioState.status) ? handleOpenInTraces : null
              }
              dejaViewHref={dejaView.href ?? null}
            />
            {headerEnd}
          </HStack>
        </HStack>

        {/* Chip strip — metrics + copyable ids, one visual language
            with the Traces V2 drawer header */}
        <RunDetailChips
          scenarioState={scenarioState}
          timeAgo={timeAgo}
          isArchived={Boolean(scenarioData?.archivedAt)}
          copyableIds={copyableIds}
        />
      </VStack>

      {/* Body — accordion sections, Traces V2 drawer language */}
      <Accordion.Root multiple value={openSections} onValueChange={(e) => setOpenSections(e.value)}>
        {/* Conversation — hidden when empty (e.g. stalled runs) */}
        {hasConversation && (
          <RunDetailSection
            value="conversation"
            title="Conversation"
            count={conversationCount}
            isFirst
            actions={
              <ConversationExpandButton
                expandAllMessages={expandAllMessages}
                onToggle={() => setExpandAllMessages((value) => !value)}
              />
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
                // A voice "Call it myself" caller is a real person, so
                // their turns read as "You", not "User Simulator" (#8020).
                isHumanCaller={isHumanCallerRun(scenarioState.metadata)}
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
                    color="fg.subtle"
                    _hover={{ color: "fg.subtle", bg: "bg.panel" }}
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
                <ParameterRow key={name} name={name} value={SECRET_VALUE_MASK} muted={true} />
              ))}
            </VStack>
          </RunDetailSection>
        )}
      </Accordion.Root>
    </>
  );
}

/** The Run Again modal and the scenario editor a run's actions open. */
export function RunDetailDialogs({ detail }: { detail: ScenarioRunDetail }) {
  const {
    runModalOpen,
    setRunModalOpen,
    handleRunAgain,
    persistedTarget,
    isRunning,
    scenarioEditorOpen,
    setScenarioEditorOpen,
    scenarioId,
  } = detail;
  return (
    <>
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
