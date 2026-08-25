/**
 * The body of the run drawer: the conversation, the judge results and the
 * parameters, beside each other when the window gives enough room and stacked
 * under each other when it does not.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import {
  Accordion,
  Box,
  Grid,
  HStack,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { CopyButton } from "~/components/CopyButton";
import { RunDetailSection } from "~/components/simulations/RunDetailSection";
import { ScenarioMessageRenderer } from "~/components/simulations/ScenarioMessageRenderer";
import {
  formatResultsForCopy,
  ParameterRow,
  SECRET_VALUE_MASK,
} from "~/components/simulations/ScenarioRunDetailDrawer";
import { SimulationConsole } from "~/components/simulations/simulation-console/SimulationConsole";
import { ConversationExpandContext } from "~/features/traces-v2/components/TraceDrawer/conversationView/expandContext";
import { isTerminalStatus } from "~/server/scenarios/scenario-event.enums";
import { hasCriteria, type RunDetail } from "./useRunDrawerState";

/** What the console title bar reads in Agent Testing. */
export const AGENT_TESTING_CONSOLE_FILE_NAME = "test-results.log";

function ConversationSection({ detail }: { detail: RunDetail }) {
  const { scenarioState, project } = detail;
  if (!scenarioState) return null;

  if (detail.shouldShowNoResponse) {
    return (
      <RunDetailSection value="no-response" title="Conversation" isFirst>
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
      </RunDetailSection>
    );
  }

  if (!detail.hasConversation) {
    return (
      <RunDetailSection value="conversation" title="Conversation" isFirst>
        <HStack gap={2} color="fg.muted" paddingY={6} justify="center">
          <Spinner size="xs" />
          <Text fontSize="sm">Waiting for the first message</Text>
        </HStack>
      </RunDetailSection>
    );
  }

  return (
    <RunDetailSection
      value="conversation"
      title="Conversation"
      count={detail.conversationCount}
      isFirst
    >
      <ConversationExpandContext.Provider
        value={{ isExpandable: true, shouldExpandAll: false }}
      >
        <ScenarioMessageRenderer
          messages={scenarioState.messages ?? []}
          streamingMessages={detail.streamingMessages}
          variant="drawer"
          projectId={project?.id ?? ""}
        />
      </ConversationExpandContext.Provider>
    </RunDetailSection>
  );
}

/** The verdict of the judge, once it has one. */
function ResultsConsole({ detail }: { detail: RunDetail }) {
  const { scenarioState } = detail;
  if (!scenarioState) return null;

  return (
    <Box
      borderRadius="xl"
      overflow="hidden"
      borderWidth="1px"
      borderColor="border.muted"
      boxShadow="sm"
    >
      <SimulationConsole
        fileName={AGENT_TESTING_CONSOLE_FILE_NAME}
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
  );
}

function ResultsSection({
  detail,
  isFirst,
}: {
  detail: RunDetail;
  isFirst: boolean;
}) {
  const { scenarioState } = detail;
  if (!scenarioState) return null;

  // A run that has not settled has no verdict, whatever its stored results
  // hold. Drawing the console then reads "0/0", which says the judge failed
  // every criterion rather than that it has not spoken yet.
  const isJudgePending =
    !isTerminalStatus(scenarioState.status) && !hasCriteria(scenarioState);

  return (
    <RunDetailSection
      value="results"
      title="Results"
      count={detail.criteria?.total}
      isFirst={isFirst}
    >
      {isJudgePending ? (
        <VStack
          align="center"
          gap={2}
          paddingY={8}
          color="fg.muted"
          data-testid="judge-pending"
        >
          <Spinner size="xs" />
          <Text fontSize="sm">The judge has not run yet.</Text>
        </VStack>
      ) : (
        <ResultsConsole detail={detail} />
      )}
    </RunDetailSection>
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

/** The conversation beside the results. */
function SideBySideContent({ detail }: { detail: RunDetail }) {
  return (
    <Grid
      templateColumns="minmax(0, 1fr) minmax(0, 460px)"
      flex={1}
      minHeight={0}
      data-testid="wide-drawer-side-by-side"
    >
      <Box
        style={{ overflowY: "auto" }}
        borderRightWidth="1px"
        borderColor="border"
        data-testid="wide-drawer-conversation"
      >
        <Accordion.Root multiple defaultValue={["conversation", "no-response"]}>
          <ConversationSection detail={detail} />
        </Accordion.Root>
      </Box>
      <Box style={{ overflowY: "auto" }} data-testid="wide-drawer-results">
        <Accordion.Root multiple defaultValue={["results", "parameters"]}>
          <ResultsSection detail={detail} isFirst />
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
      <Accordion.Root
        multiple
        defaultValue={["conversation", "no-response", "results", "parameters"]}
      >
        <ConversationSection detail={detail} />
        <ResultsSection
          detail={detail}
          isFirst={!detail.hasConversation && !detail.shouldShowNoResponse}
        />
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
