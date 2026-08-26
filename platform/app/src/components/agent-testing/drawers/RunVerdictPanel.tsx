/**
 * What the judge decided about one run: a labelled status line, the criteria
 * that passed in one section, the criteria that failed in another, and
 * whatever the judge said about the run as a whole.
 *
 * The panel carries no status pill, no success rate, no criteria count and no
 * duration: the chip strip at the top of the drawer already reads all four.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CircleCheck, CircleX, XCircle } from "lucide-react";
import { JsonHighlight } from "~/features/onboarding/components/sections/shared/JsonHighlight";
import { safePrettyJson } from "~/features/traces-v2/components/TraceDrawer/JsonHighlight";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { FG_MUTED } from "../shared/design";

/**
 * The criteria of a run split into passed and failed, each list held in the
 * order the test case declares them.
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
const SPACE_ABOVE_CRITERIA = 3.5;
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
 * The labelled status line at the top of the panel. It reads the run status
 * as a single word: PASSED in green when the run met every criterion, FAILED
 * in red when the judge missed one.
 */
function VerdictStatusLine({ status }: { status: ScenarioRunStatus }) {
  const word =
    status === ScenarioRunStatus.SUCCESS
      ? "PASSED"
      : status === ScenarioRunStatus.FAILED
        ? "FAILED"
        : null;
  if (!word) return null;
  const color = word === "PASSED" ? "green.600" : "red.600";
  return (
    <HStack gap={2} alignItems="baseline" data-testid="run-verdict-status-line">
      <Text fontSize="12px" color={FG_MUTED}>
        Status:
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
function readReasoningError(
  reasoning: string | null | undefined,
): { name: string; pretty: string } | null {
  if (!reasoning) return null;
  const trimmed = reasoning.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "name" in parsed &&
      typeof (parsed as { name?: unknown }).name === "string" &&
      /error$/i.test((parsed as { name: string }).name)
    ) {
      return {
        name: (parsed as { name: string }).name,
        pretty: JSON.stringify(parsed, null, 2),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The judge failure, drawn as a self-contained scrollable panel. The heading
 * carries a red icon so the eye reads "this is the error", not "this is the
 * judge's thought".
 */
function JudgeErrorPanel({ pretty }: { pretty: string }) {
  return (
    <VStack align="stretch" gap={2} marginTop={SPACE_BELOW_CRITERIA}>
      <PanelHeading
        icon={<XCircle size={13} color="var(--chakra-colors-red-fg)" />}
      >
        Judge reasoning
      </PanelHeading>
      <Box
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        background={{ base: "gray.900", _dark: "black" }}
        color={{ base: "white", _dark: "gray.100" }}
        maxHeight="320px"
        overflow="auto"
        data-testid="run-verdict-reasoning-error"
      >
        <JsonHighlight code={pretty} />
      </Box>
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
  /** The criteria the test case declares, in its own order. */
  declaredCriteria: readonly string[];
  /** What the judge said about the run as a whole, if anything. */
  reasoning?: string | null;
  /** Why the run never reached a verdict, when that is what happened. */
  error?: string | null;
}) {
  const reasoningError = readReasoningError(reasoning);
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
      <VStack
        align="stretch"
        gap={SPACE_BETWEEN_SECTIONS}
        marginTop={SPACE_ABOVE_CRITERIA}
      >
        {error ? (
          <Text
            fontSize="11.5px"
            color="red.fg"
            whiteSpace="pre-wrap"
            data-testid="run-verdict-error"
          >
            {error}
          </Text>
        ) : null}
        <CriteriaSection
          heading="Passed criteria"
          headingColor="green.600"
          criteria={orderedMet}
          passed={true}
          testId="run-verdict-passed-criteria"
        />
        <CriteriaSection
          heading="Failed criteria"
          headingColor="red.600"
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
      {reasoningError ? (
        <JudgeErrorPanel pretty={reasoningError.pretty} />
      ) : reasoning ? (
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

/** Re-exported for tests. */
export const __RUN_VERDICT_INTERNAL = {
  readReasoningError,
  safePrettyJson,
  orderCriteria,
};
