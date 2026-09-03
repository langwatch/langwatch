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

import { Accordion, Box, Grid, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { RunDetailSection } from "../../../../index";
import { ScenarioMessageRenderer } from "../../simulations/scenario-message-renderer";
import { ParameterRow, SECRET_VALUE_MASK } from "../../simulations/scenario-run-detail-drawer";
import { ConversationExpandContext } from "@langwatch/trace-web/explorer/components/TraceDrawer/conversationView/expandContext";
import { isTerminalStatus, ScenarioRunStatus } from "@langwatch/scenario-contract";
import { RunVerdictPanel } from "../../../elements/agent-testing/drawers/run-verdict-panel";
import { nextSpeakerOf } from "../../../elements/next-speaker";
import { TypingBubble } from "../../../elements/typing-bubble";
import { hasVerdict, type RunDetail, type RunScenarioState } from "./use-run-drawer-state";

/** How wide the results read beside the conversation. */
const RESULTS_COLUMN_WIDTH = "310px";

/** The statuses of a run whose job has not started yet. */
const NOT_STARTED_STATUSES = new Set<string>([ScenarioRunStatus.QUEUED, ScenarioRunStatus.PENDING]);

/** One line where the messages will be, for a run with none yet. */
function ConversationWaitingLine({ message, testId }: { message: string; testId: string }) {
  return (
    <HStack gap={2} color="fg.muted" paddingY={6} justify="center">
      <Spinner size="xs" />
      <Text fontSize="sm" data-testid={testId}>
        {message}
      </Text>
    </HStack>
  );
}

/** An empty state that says why there is nothing to read. */
function ConversationEmptyState({
  title,
  detail,
  testId,
}: {
  title: string;
  detail: string;
  testId: string;
}) {
  return (
    <VStack
      align="center"
      justify="center"
      gap={2}
      paddingY={8}
      color="fg.muted"
      data-testid={testId}
    >
      <Text fontSize="sm" fontWeight="medium" color="fg">
        {title}
      </Text>
      <Text fontSize="xs" textAlign="center" maxWidth="320px">
        {detail}
      </Text>
    </VStack>
  );
}

/**
 * What stands where the messages will be, on a run that has none.
 *
 * A run waiting for its turn says so, a run that failed before anyone spoke
 * says that instead of reading as one still waiting, and a run whose next
 * speaker is known draws the bubble that message will land in.
 */
function EmptyConversation({
  detail,
  scenarioState,
  typingRole,
}: {
  detail: RunDetail;
  scenarioState: RunScenarioState;
  typingRole: ReturnType<typeof nextSpeakerOf>;
}) {
  if (NOT_STARTED_STATUSES.has(scenarioState.status)) {
    return <ConversationWaitingLine message="Queued" testId="wide-drawer-queued" />;
  }
  if (scenarioState.results?.error) {
    return (
      <ConversationEmptyState
        title="Simulation failed"
        detail="It failed before the first message was sent. The reason reads with the results."
        testId="scenario-run-failed-empty"
      />
    );
  }
  if (typingRole) return <TypingBubble role={typingRole} />;
  return (
    <ConversationWaitingLine message="Waiting for the first message" testId="wide-drawer-waiting" />
  );
}

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
        <ConversationEmptyState
          title="No response"
          detail="The agent under test didn't return any messages for this run."
          testId="scenario-no-response"
        />
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
        <EmptyConversation detail={detail} scenarioState={scenarioState} typingRole={typingRole} />
      </ConversationBox>
    );
  }

  return (
    <ConversationBox>
      <ConversationExpandContext.Provider value={{ isExpandable: true, shouldExpandAll: false }}>
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
const RUN_QUEUED_MESSAGE = "Waiting for the run to start";
const CONVERSATION_RUNNING_MESSAGE = "Waiting for more turns to define a verdict";
const JUDGE_READING_MESSAGE = "The judge is reading the conversation";

/**
 * The statuses a run reaches once the judge has spoken. The verdict itself is
 * written separately, so a run can carry one of these for a moment before its
 * criteria arrive; the drawer rereads the run over that moment.
 */
const JUDGED_STATUSES = new Set<string>([ScenarioRunStatus.SUCCESS, ScenarioRunStatus.FAILED]);

/**
 * What the run is still doing, while it has no verdict to show.
 *
 * The judge reads the conversation after every turn and is what ends the run,
 * so a run that is still going is one whose turns have not settled a verdict
 * yet, and a run that has settled but carries no verdict is one whose written
 * verdict has not landed.
 *
 * A verdict is a verdict even with no criteria under it: a scripted run, such
 * as the ping an agent test sends, is judged by its script and answers with a
 * verdict and a reasoning alone.
 */
function pendingMessageFor(scenarioState: RunScenarioState): string | null {
  if (hasVerdict(scenarioState)) return null;
  if (NOT_STARTED_STATUSES.has(scenarioState.status)) {
    return RUN_QUEUED_MESSAGE;
  }
  if (!isTerminalStatus(scenarioState.status)) {
    return CONVERSATION_RUNNING_MESSAGE;
  }
  return JUDGED_STATUSES.has(scenarioState.status) ? JUDGE_READING_MESSAGE : null;
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
      paddingX={14}
      data-testid="run-verdict-pending"
    >
      <Text fontSize="12px" color="fg.muted" textAlign="center">
        {message}
      </Text>
    </VStack>
  );
}

/** The verdict of the judge, once it has one. */
function ResultsSection({ detail, isFirst }: { detail: RunDetail; isFirst: boolean }) {
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
          <ParameterRow key={name} name={name} value={SECRET_VALUE_MASK} muted />
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
        display="flex"
        flexDirection="column"
        style={{ overflowY: "auto" }}
        borderLeftWidth="1px"
        borderColor="border.muted"
        data-testid="wide-drawer-results"
      >
        <ResultsSection detail={detail} isFirst />
        {/* The parameters read what the run was given, not what it decided,
            so they sit at the foot of the column, under whatever room the
            verdict takes. */}
        <Box marginTop="auto" data-testid="wide-drawer-results-footer">
          <Accordion.Root multiple defaultValue={["parameters"]}>
            <ParametersSection detail={detail} />
          </Accordion.Root>
        </Box>
      </Box>
    </Grid>
  );
}

/** The sections under each other, as the v1 drawer reads. */
function StackedContent({ detail }: { detail: RunDetail }) {
  return (
    <Box flex={1} minHeight={0} overflowY="auto" data-testid="wide-drawer-stacked">
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
