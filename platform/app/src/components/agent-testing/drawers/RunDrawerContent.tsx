/**
 * The body of the run drawer: the conversation, the judge results and the
 * parameters, beside each other when the window gives enough room and stacked
 * under each other when it does not.
 *
 * The results read as a plain list of the criteria the judge scored. They are
 * always open: they are the answer the drawer was opened for.
 *
 * The messages carry no section heading and no line between them and the
 * results, so the drawer reads as one page rather than two panes.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Accordion, Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { nextSpeakerOf } from "~/components/simulations/next-speaker";
import { RunDetailSection } from "~/components/simulations/RunDetailSection";
import { ScenarioMessageRenderer } from "~/components/simulations/ScenarioMessageRenderer";
import {
  ParameterRow,
  SECRET_VALUE_MASK,
} from "~/components/simulations/ScenarioRunDetailDrawer";
import { TypingBubble } from "~/components/simulations/TypingBubble";
import { ConversationExpandContext } from "~/features/traces-v2/components/TraceDrawer/conversationView/expandContext";
import {
  isTerminalStatus,
  ScenarioRunStatus,
} from "~/server/scenarios/scenario-event.enums";
import { RunVerdictPanel } from "./RunVerdictPanel";
import {
  hasCriteria,
  type RunDetail,
  type RunScenarioState,
} from "./useRunDrawerState";

/** How wide the results read beside the conversation. */
const RESULTS_COLUMN_WIDTH = "310px";

/**
 * The messages of the run. They carry no section heading: the drawer opens on
 * the conversation, so a header over it says only what the reader can see.
 */
function ConversationSection({ detail }: { detail: RunDetail }) {
  const { scenarioState, project } = detail;
  if (!scenarioState) return null;

  if (detail.shouldShowNoResponse) {
    return (
      <ConversationBox>
        <VStack
          align="center"
          justify="center"
          gap={2}
          paddingY={8}
          color="fg.muted"
          data-testid="scenario-no-response"
        >
          <Text fontSize="sm" fontWeight="medium" color="fg">
            No response
          </Text>
          <Text fontSize="xs" textAlign="center" maxWidth="320px">
            The agent under test didn&apos;t return any messages for this run.
          </Text>
        </VStack>
      </ConversationBox>
    );
  }

  const typingRole = nextSpeakerOf({
    messages: scenarioState.messages ?? [],
    streamingMessages: detail.streamingMessages,
    status: scenarioState.status,
  });

  if (!detail.hasConversation) {
    return (
      <ConversationBox>
        {typingRole ? (
          <TypingBubble role={typingRole} />
        ) : (
          <HStack gap={2} color="fg.muted" paddingY={6} justify="center">
            <Text fontSize="sm">Waiting for the first message</Text>
          </HStack>
        )}
      </ConversationBox>
    );
  }

  return (
    <ConversationBox>
      <ConversationExpandContext.Provider
        value={{ isExpandable: true, shouldExpandAll: false }}
      >
        <ScenarioMessageRenderer
          messages={scenarioState.messages ?? []}
          streamingMessages={detail.streamingMessages}
          variant="drawer"
          projectId={project?.id ?? ""}
          typingRole={typingRole}
        />
      </ConversationExpandContext.Provider>
    </ConversationBox>
  );
}

/** The padding the messages sit in, the same the sections take. */
function ConversationBox({ children }: { children: React.ReactNode }) {
  return (
    <Box paddingX={4} paddingY={3} data-testid="run-drawer-conversation-body">
      {children}
    </Box>
  );
}

/** What the results column says while a run has not reached a verdict. */
const CONVERSATION_RUNNING_MESSAGE =
  "Waiting for the conversation to end, then the judge reads it";
const JUDGE_READING_MESSAGE = "The judge is reading the conversation";

/**
 * The statuses a run reaches once the judge has spoken. The verdict itself is
 * written separately, so a run can carry one of these for a moment before its
 * criteria arrive; the drawer rereads the run over that moment.
 */
const JUDGED_STATUSES = new Set<string>([
  ScenarioRunStatus.SUCCESS,
  ScenarioRunStatus.FAILED,
]);

/**
 * What the run is still doing, while it has no verdict to show.
 *
 * The conversation runs first and the judge reads it afterwards, so the status
 * of the run is what separates the two: the judge speaks only once the run has
 * finished, and a finished run whose verdict has not landed yet is one the
 * judge has just read.
 *
 * A verdict is a verdict even with no criteria under it: a scripted run, such
 * as the ping an agent test sends, is judged by its script and answers with a
 * verdict and a reasoning alone.
 */
function pendingMessageFor(scenarioState: RunScenarioState): string | null {
  if (hasVerdict(scenarioState)) return null;
  if (!isTerminalStatus(scenarioState.status)) {
    return CONVERSATION_RUNNING_MESSAGE;
  }
  return JUDGED_STATUSES.has(scenarioState.status)
    ? JUDGE_READING_MESSAGE
    : null;
}

/** True once the judge has spoken: criteria, a verdict, a reasoning or an error. */
function hasVerdict(scenarioState: RunScenarioState): boolean {
  const results = scenarioState.results;
  if (!results) return false;
  return (
    hasCriteria(scenarioState) ||
    Boolean(results.error) ||
    Boolean(results.verdict) ||
    Boolean(results.reasoning)
  );
}

/**
 * What the run is doing, where its results will be. The conversation beside it
 * already moves, so this reads as one quiet line in the middle of the column
 * rather than a second thing that spins.
 */
function PendingVerdictLine({ message }: { message: string }) {
  return (
    <VStack
      align="center"
      justify="flex-start"
      paddingTop="64px"
      paddingX={2}
      data-testid="run-verdict-pending"
    >
      <Text fontSize="12px" color="fg.muted" textAlign="center">
        {message}
      </Text>
    </VStack>
  );
}

/** The verdict of the judge, once it has one. */
function ResultsSection({
  detail,
  isFirst,
}: {
  detail: RunDetail;
  isFirst: boolean;
}) {
  const { scenarioState } = detail;
  if (!scenarioState) return null;

  // A run without a verdict has nothing to score. Drawing the criteria then
  // reads "0 of 0 met", which says the judge failed every criterion rather
  // than that it has not spoken yet.
  const pendingMessage = pendingMessageFor(scenarioState);

  return (
    <Box
      paddingX={4}
      paddingY={3}
      borderTopWidth={isFirst ? "0" : "1px"}
      borderColor="border.muted"
    >
      {pendingMessage ? (
        <PendingVerdictLine message={pendingMessage} />
      ) : (
        <RunVerdictPanel
          status={scenarioState.status}
          metCriteria={scenarioState.results?.metCriteria ?? []}
          unmetCriteria={scenarioState.results?.unmetCriteria ?? []}
          declaredCriteria={detail.scenarioData?.criteria ?? []}
          reasoning={scenarioState.results?.reasoning}
          error={scenarioState.results?.error}
        />
      )}
    </Box>
  );
}

function ParametersSection({ detail }: { detail: RunDetail }) {
  const total = detail.parameters.length + detail.secretParameterNames.length;
  if (total === 0) return null;

  return (
    <RunDetailSection value="parameters" title="Parameters" count={total}>
      <VStack align="stretch" gap={1.5} data-testid="run-parameters">
        {detail.parameters.map(([name, value]) => (
          <ParameterRow key={name} name={name} value={String(value)} />
        ))}
        {detail.secretParameterNames.map((name) => (
          <ParameterRow
            key={name}
            name={name}
            value={SECRET_VALUE_MASK}
            muted
          />
        ))}
      </VStack>
    </RunDetailSection>
  );
}

/**
 * The conversation beside the results. Nothing is drawn between the two
 * columns: the results start where the messages end.
 */
function SideBySideContent({ detail }: { detail: RunDetail }) {
  return (
    <Grid
      templateColumns={`minmax(0, 1fr) minmax(0, ${RESULTS_COLUMN_WIDTH})`}
      flex={1}
      minHeight={0}
      data-testid="wide-drawer-side-by-side"
    >
      <Box style={{ overflowY: "auto" }} data-testid="wide-drawer-conversation">
        <ConversationSection detail={detail} />
      </Box>
      <Box
        style={{ overflowY: "auto" }}
        borderLeftWidth="1px"
        borderColor="border.muted"
        data-testid="wide-drawer-results"
      >
        <ResultsSection detail={detail} isFirst />
        <Accordion.Root multiple defaultValue={["parameters"]}>
          <ParametersSection detail={detail} />
        </Accordion.Root>
      </Box>
    </Grid>
  );
}

/** The sections under each other, as the v1 drawer reads. */
function StackedContent({ detail }: { detail: RunDetail }) {
  return (
    <Box
      flex={1}
      minHeight={0}
      overflowY="auto"
      data-testid="wide-drawer-stacked"
    >
      <ConversationSection detail={detail} />
      <ResultsSection
        detail={detail}
        isFirst={!detail.hasConversation && !detail.shouldShowNoResponse}
      />
      <Accordion.Root multiple defaultValue={["parameters"]}>
        <ParametersSection detail={detail} />
      </Accordion.Root>
    </Box>
  );
}

export function RunDrawerContent({
  detail,
  isSideBySide,
}: {
  detail: RunDetail;
  isSideBySide: boolean;
}) {
  if (isSideBySide) return <SideBySideContent detail={detail} />;
  return <StackedContent detail={detail} />;
}
