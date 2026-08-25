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

/** The heading of the panel. */
function VerdictHeading() {
  return (
    <HStack
      gap={1.5}
      fontSize="10.5px"
      fontWeight="semibold"
      textTransform="uppercase"
      letterSpacing="0.025em"
      color={FG_MUTED}
    >
      <Scale size={11} />
      <Text as="span">Results</Text>
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
      <VerdictHeading />
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
        <Text
          fontSize="11.5px"
          color={FG_MUTED}
          whiteSpace="pre-wrap"
          data-testid="run-verdict-reasoning"
        >
          {reasoning}
        </Text>
      ) : null}
    </VStack>
  );
}
