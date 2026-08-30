/**
 * What the judge decided about one run: a labelled verdict line, then the
 * criteria that passed in one section, the criteria that failed in another,
 * and whatever the judge said about the run as a whole.
 *
 * The panel carries no status pill, no success rate, no criteria count and no
 * duration: the chip strip at the top of the drawer already reads all four.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Box, Button, HStack, Text, VStack } from "@chakra-ui/react";
import {
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  resolveScenarioError,
  scenarioErrorDetail,
  scenarioErrorTitle,
} from "~/server/scenarios/scenario-infra-error";
import { FG_MUTED } from "../shared/design";

/**
 * The colour a passed and a failed verdict read in, taken from the status
 * config every other surface reads, so one run says the same thing in the
 * list, in the drawer and on the verdict panel.
 */
const PASSED_COLOR =
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.SUCCESS].fgColor;
const FAILED_COLOR =
  SCENARIO_RUN_STATUS_CONFIG[ScenarioRunStatus.FAILED].fgColor;

/**
 * The criteria of a run split into passed and failed, each list held in the
 * order the scenario declares them.
 *
 * The judge answers with two lists, met and unmet, which lose the order the
 * case was written in. The case still holds that order, so it is what each
 * list is sorted by. A criterion the case no longer declares keeps its place
 * at the end of its list rather than being dropped.
 */
function orderCriteria(
  criteria: readonly string[],
  declaredCriteria: readonly string[],
): string[] {
  const rankOf = (criterion: string) => {
    const at = declaredCriteria.indexOf(criterion);
    return at === -1 ? declaredCriteria.length : at;
  };
  return [...criteria]
    .map((criterion, at) => ({ criterion, at, rank: rankOf(criterion) }))
    .sort((left, right) => left.rank - right.rank || left.at - right.at)
    .map((entry) => entry.criterion);
}

/** How tall the heading reads: the box both the icon and the capitals fill. */
const HEADING_LINE_HEIGHT = "14px";

/**
 * The rhythm of the panel. The judge reasoning is a section of its own, so the
 * space over its heading is the widest of the panel and the space under its
 * paragraph is narrower than that.
 */
const SPACE_BELOW_VERDICT = 4;
const SPACE_BELOW_CRITERIA = 6;
const SPACE_BELOW_REASONING = 3.5;

/** How far one criteria section sits from the next. */
const SPACE_BETWEEN_SECTIONS = 4;

/**
 * One heading of the panel. The icon and the capitals beside it share one line
 * box of a fixed height, so both center on the same middle rather than each on
 * a box of its own size.
 */
function PanelHeading({
  children,
  icon,
  color = FG_MUTED,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  color?: string;
}) {
  return (
    <HStack
      gap={1.5}
      alignItems="center"
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={color}
    >
      {icon ? (
        <Box
          as="span"
          display="flex"
          alignItems="center"
          justifyContent="center"
          height={HEADING_LINE_HEIGHT}
          lineHeight={0}
          flexShrink={0}
          marginTop="-2px"
        >
          {icon}
        </Box>
      ) : null}
      <Text as="span" lineHeight={HEADING_LINE_HEIGHT}>
        {children}
      </Text>
    </HStack>
  );
}

/**
 * The labelled verdict line at the top of the panel. It reads the run status
 * as a single word: PASSED in green when the run met every criterion, FAILED
 * in red when the judge missed one. It reads first because it is the answer;
 * the criteria under it are how the judge got there.
 */
function VerdictStatusLine({ status }: { status: ScenarioRunStatus }) {
  const word =
    status === ScenarioRunStatus.SUCCESS
      ? "PASSED"
      : status === ScenarioRunStatus.FAILED
        ? "FAILED"
        : null;
  if (!word) return null;
  const color = word === "PASSED" ? PASSED_COLOR : FAILED_COLOR;
  return (
    <HStack
      gap={2}
      alignItems="baseline"
      marginBottom={SPACE_BELOW_VERDICT}
      data-testid="run-verdict-status-line"
    >
      <Text fontSize="12px" color={FG_MUTED}>
        Verdict:
      </Text>
      <Text
        fontSize="13px"
        fontWeight="bold"
        textTransform="uppercase"
        letterSpacing="0.03em"
        color={color}
        data-testid={
          word === "PASSED"
            ? "run-verdict-status-passed"
            : "run-verdict-status-failed"
        }
      >
        {word}
      </Text>
    </HStack>
  );
}

/** One criterion row: the pass or fail icon and the plain criterion string. */
function CriterionRow({
  criterion,
  passed,
}: {
  criterion: string;
  passed: boolean;
}) {
  return (
    <HStack align="start" gap={2}>
      <Box
        marginTop="1px"
        flexShrink={0}
        color={passed ? "green.fg" : "red.fg"}
      >
        {passed ? <CircleCheck size={14} /> : <CircleX size={14} />}
      </Box>
      <Box minWidth={0}>
        <Text fontSize="12px" fontWeight="medium">
          {criterion}
        </Text>
      </Box>
    </HStack>
  );
}

/**
 * One list of criteria under its own heading. The section draws nothing when
 * the list is empty: the sibling section already carries the story.
 */
function CriteriaSection({
  heading,
  headingColor,
  criteria,
  passed,
  testId,
}: {
  heading: string;
  headingColor: string;
  criteria: readonly string[];
  passed: boolean;
  testId: string;
}) {
  if (criteria.length === 0) return null;
  return (
    <VStack align="stretch" gap={2} data-testid={testId}>
      <PanelHeading color={headingColor}>{heading}</PanelHeading>
      <VStack align="stretch" gap={2.5}>
        {criteria.map((criterion, at) => (
          <CriterionRow
            key={`${criterion}-${at}`}
            criterion={criterion}
            passed={passed}
          />
        ))}
      </VStack>
    </VStack>
  );
}

/**
 * True when the reasoning payload is an error object rather than a paragraph.
 *
 * The judge fails at every layer under the same shape: an object with a
 * `name` that ends in `Error` and, most of the time, a `message` and a
 * `stack`. When the payload parses as one, the drawer must not read it as
 * "the judge's reasoning"; it reads as the failure the run hit.
 */
function isErrorPayload(reasoning: string | null | undefined): boolean {
  if (!reasoning) return false;
  const trimmed = reasoning.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return (
      !!parsed &&
      typeof parsed === "object" &&
      "name" in parsed &&
      typeof (parsed as { name?: unknown }).name === "string" &&
      /error$/i.test((parsed as { name: string }).name)
    );
  } catch {
    return false;
  }
}

/**
 * The reasoning the scenario runner writes for every run it fails: the raw
 * failure text with one sentence in front of it. The failure panel already
 * names that failure, so a drawer that draws both reads it twice, the second
 * time as the raw text the panel exists to replace.
 */
const RESTATED_FAILURE_PREFIX = /^scenario failed with error:/i;

/** True when the reasoning only restates a failure that is drawn already. */
function restatesFailure(reasoning: string): boolean {
  return RESTATED_FAILURE_PREFIX.test(reasoning.trim());
}

/**
 * Why a run never reached a verdict, read as a named failure.
 *
 * A run stores whatever failed it: an envelope the failure handler wrote, the
 * scenario SDK's `{ name, message, stack }`, or a plain sentence. All three
 * resolve to one title, one message the customer can act on, and one hint. The
 * raw text sits behind More info, because a stack answers "where" for the one
 * reader who asks for it and says nothing to everybody else.
 */
function RunFailurePanel({ raw }: { raw: string }) {
  const [detailOpen, setDetailOpen] = useState(false);
  const handled = resolveScenarioError(raw);
  const detail = scenarioErrorDetail(raw);
  const hasDetail = !!detail && detail.trim() !== handled.message.trim();

  return (
    <VStack align="stretch" gap={2} data-testid="run-verdict-error">
      <PanelHeading
        color={FAILED_COLOR}
        icon={<XCircle size={13} color="var(--chakra-colors-red-fg)" />}
      >
        {scenarioErrorTitle(handled.code)}
      </PanelHeading>
      <Text
        fontSize="12px"
        lineHeight="short"
        wordBreak="break-word"
        data-testid="run-verdict-error-message"
      >
        {handled.message}
      </Text>
      {handled.hint ? (
        <Text
          fontSize="11.5px"
          color={FG_MUTED}
          lineHeight="short"
          wordBreak="break-word"
          data-testid="run-verdict-error-hint"
        >
          {handled.hint}
        </Text>
      ) : null}
      {hasDetail ? (
        <VStack align="stretch" gap={2}>
          <Button
            alignSelf="flex-start"
            variant="plain"
            size="xs"
            height="auto"
            paddingX={0}
            fontSize="11px"
            color={FG_MUTED}
            onClick={() => setDetailOpen((open) => !open)}
            data-testid="run-verdict-error-toggle"
          >
            {detailOpen ? (
              <ChevronDown size={12} />
            ) : (
              <ChevronRight size={12} />
            )}
            {detailOpen ? "Hide details" : "More info"}
          </Button>
          {detailOpen ? (
            <Box
              borderWidth="1px"
              borderColor="border.muted"
              borderRadius="md"
              background="bg.subtle"
              padding={2}
              maxHeight="260px"
              overflow="auto"
              data-testid="run-verdict-error-detail"
            >
              <Text
                as="pre"
                fontFamily="mono"
                fontSize="10.5px"
                lineHeight="short"
                color={FG_MUTED}
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {detail}
              </Text>
            </Box>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
}

export function RunVerdictPanel({
  status,
  metCriteria,
  unmetCriteria,
  declaredCriteria,
  reasoning,
  error,
}: {
  /** The terminal status of the run: pass, fail, or neither. */
  status: ScenarioRunStatus;
  /** The criteria the judge met, in any order the judge returned them. */
  metCriteria: readonly string[];
  /** The criteria the judge missed, in any order the judge returned them. */
  unmetCriteria: readonly string[];
  /** The criteria the scenario declares, in its own order. */
  declaredCriteria: readonly string[];
  /** What the judge said about the run as a whole, if anything. */
  reasoning?: string | null;
  /** Why the run never reached a verdict, when that is what happened. */
  error?: string | null;
}) {
  const reasoningIsError = isErrorPayload(reasoning);
  const showsReasoning =
    !!reasoning && !(!!error && restatesFailure(reasoning));
  const orderedMet = orderCriteria(metCriteria, declaredCriteria);
  const orderedUnmet = orderCriteria(unmetCriteria, declaredCriteria);
  const hasAnyCriteria = orderedMet.length + orderedUnmet.length > 0;

  return (
    <VStack
      align="stretch"
      gap={0}
      paddingBottom={SPACE_BELOW_REASONING}
      data-testid="run-verdict-panel"
    >
      <VerdictStatusLine status={status} />
      <VStack align="stretch" gap={SPACE_BETWEEN_SECTIONS}>
        {error ? <RunFailurePanel raw={error} /> : null}
        <CriteriaSection
          heading="Passed criteria"
          headingColor={PASSED_COLOR}
          criteria={orderedMet}
          passed={true}
          testId="run-verdict-passed-criteria"
        />
        <CriteriaSection
          heading="Failed criteria"
          headingColor={FAILED_COLOR}
          criteria={orderedUnmet}
          passed={false}
          testId="run-verdict-failed-criteria"
        />
        {!hasAnyCriteria && !error ? (
          <Text fontSize="12px" color={FG_MUTED}>
            The judge scored no criteria for this run.
          </Text>
        ) : null}
      </VStack>
      {reasoningIsError && reasoning ? (
        <Box marginTop={SPACE_BELOW_CRITERIA}>
          <RunFailurePanel raw={reasoning} />
        </Box>
      ) : showsReasoning && reasoning ? (
        <VStack align="stretch" gap={2} marginTop={SPACE_BELOW_CRITERIA}>
          <PanelHeading>Judge reasoning</PanelHeading>
          <Text
            fontSize="11.5px"
            color={FG_MUTED}
            lineHeight="short"
            whiteSpace="pre-wrap"
            wordBreak="break-word"
            data-testid="run-verdict-reasoning"
          >
            {reasoning}
          </Text>
        </VStack>
      ) : null}
    </VStack>
  );
}
