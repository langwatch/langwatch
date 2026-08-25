/**
 * What the judge decided about one run: every criterion of the test case, in
 * the order the case declares them, each marked met or unmet, and whatever the
 * judge said about the run as a whole.
 *
 * The panel carries no status, no success rate, no criteria count and no
 * duration: the chip strip at the top of the drawer already reads all four.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { CircleCheck, CircleX, Scale } from "lucide-react";
import { FG_MUTED } from "../shared/design";

/** One criterion of the case, with what the judge decided about it. */
export type RunVerdict = {
  criterion: string;
  passed: boolean;
  /** What the judge said about this criterion, when it said anything. */
  note?: string;
};

/**
 * The criteria of a run as one list, in the order the test case declares them.
 *
 * The judge answers with two lists, met and unmet, which loses the order the
 * case was written in. The case itself still holds that order, so it is what
 * the list is sorted by. A criterion the case no longer declares keeps its
 * place at the end rather than being dropped.
 */
export function orderVerdicts({
  metCriteria,
  unmetCriteria,
  declaredCriteria,
}: {
  metCriteria: readonly string[];
  unmetCriteria: readonly string[];
  /** The criteria the test case declares, in its own order. */
  declaredCriteria: readonly string[];
}): RunVerdict[] {
  const verdicts: RunVerdict[] = [
    ...metCriteria.map((criterion) => ({ criterion, passed: true })),
    ...unmetCriteria.map((criterion) => ({ criterion, passed: false })),
  ];

  const rankOf = (criterion: string) => {
    const at = declaredCriteria.indexOf(criterion);
    return at === -1 ? declaredCriteria.length : at;
  };

  return verdicts
    .map((verdict, at) => ({ verdict, at, rank: rankOf(verdict.criterion) }))
    .sort((left, right) => left.rank - right.rank || left.at - right.at)
    .map((entry) => entry.verdict);
}

/**
 * One heading of the panel. The icon sits in a box of its own with no line
 * height, so it centers on the capitals beside it rather than on the taller
 * line box of the text.
 */
function PanelHeading({
  children,
  icon,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <HStack
      gap={1.5}
      alignItems="center"
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_MUTED}
    >
      {icon ? (
        <Box as="span" display="flex" lineHeight={0} flexShrink={0}>
          {icon}
        </Box>
      ) : null}
      <Text as="span" lineHeight="1">
        {children}
      </Text>
    </HStack>
  );
}

/** One criterion and what the judge said about it. */
function VerdictRow({ verdict }: { verdict: RunVerdict }) {
  return (
    <HStack align="start" gap={2}>
      <Box
        marginTop="1px"
        flexShrink={0}
        color={verdict.passed ? "green.fg" : "red.fg"}
      >
        {verdict.passed ? <CircleCheck size={14} /> : <CircleX size={14} />}
      </Box>
      <Box minWidth={0}>
        <Text fontSize="12px" fontWeight="medium">
          {verdict.criterion}
        </Text>
        {verdict.note ? (
          <Text fontSize="11.5px" color={FG_MUTED} lineHeight="short">
            {verdict.note}
          </Text>
        ) : null}
      </Box>
    </HStack>
  );
}

export function RunVerdictPanel({
  verdicts,
  reasoning,
  error,
}: {
  verdicts: RunVerdict[];
  /** What the judge said about the run as a whole, if anything. */
  reasoning?: string | null;
  /** Why the run never reached a verdict, when that is what happened. */
  error?: string | null;
}) {
  return (
    <VStack align="stretch" gap={2.5} data-testid="run-verdict-panel">
      <PanelHeading icon={<Scale size={11} />}>Results</PanelHeading>
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
      {verdicts.length > 0 ? (
        <VStack align="stretch" gap={2.5}>
          {verdicts.map((verdict, at) => (
            <VerdictRow key={`${verdict.criterion}-${at}`} verdict={verdict} />
          ))}
        </VStack>
      ) : error ? null : (
        <Text fontSize="12px" color={FG_MUTED}>
          The judge scored no criteria for this run.
        </Text>
      )}
      {reasoning ? (
        <VStack align="stretch" gap={1.5} paddingTop={0.5}>
          <PanelHeading>Judge reasoning</PanelHeading>
          <Text
            fontSize="11.5px"
            color={FG_MUTED}
            lineHeight="short"
            // The judge writes in paragraphs and lists, so the breaks it wrote
            // are kept while the text still wraps to the column.
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
