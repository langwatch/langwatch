/**
 * The numbers the filters drive: a strip of totals and the pass rate over
 * time, all read from the same rows the table below lists.
 *
 * Hidden until the Charts control is used. The question comes first and the
 * answer second, so the page opens on the filters and the list rather than on
 * a wall of figures nobody asked for yet.
 *
 * Every total here states what it covers. A total that quietly leaves rows out
 * reads as the whole and is wrong by however much it dropped, which is the way
 * a cost total once under-reported this page fourfold while looking entirely
 * plausible.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */

import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { formatCost } from "~/components/shared/formatters";
import type {
  AtomCost,
  ResultTotals,
  SeriesBucket,
} from "~/server/app-layer/simulations/result-atoms/atom.types";
import { FG_MUTED } from "../shared/design";
import { formatPassRate, passRateColor } from "../shared/pass-rate-color";

/** One figure of the strip, with the line that says what it covers. */
function Stat({
  label,
  value,
  color,
  note,
  testId,
}: {
  label: string;
  value: string;
  color?: string;
  note?: string | null;
  testId?: string;
}) {
  return (
    <VStack
      align="stretch"
      justify="center"
      gap={0}
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      paddingX={3.5}
      paddingY={2.5}
      data-testid={testId}
    >
      <Text fontSize="11px" fontWeight="semibold" color={FG_MUTED}>
        {label}
      </Text>
      <Text
        fontSize="22px"
        lineHeight="1"
        fontWeight="semibold"
        marginTop={1}
        fontVariantNumeric="tabular-nums"
        color={color ?? "fg"}
      >
        {value}
      </Text>
      {note ? (
        <Text fontSize="10.5px" color={FG_MUTED} marginTop={1.5}>
          {note}
        </Text>
      ) : null}
    </VStack>
  );
}

const CHART_HEIGHT = 56;
const CHART_BAR_MAX = 30;

/** The pass rate of the window, bucket by bucket, oldest first. */
function PassRateOverTimeChart({ buckets }: { buckets: SeriesBucket[] }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      paddingX={3.5}
      paddingY={3}
      data-testid="results-pass-rate-chart"
    >
      <Text fontSize="11px" fontWeight="semibold" color={FG_MUTED}>
        Pass rate over time
      </Text>

      <HStack
        gap={1.5}
        height={`${CHART_HEIGHT}px`}
        alignItems="flex-end"
        marginTop={2}
      >
        {buckets.map((bucket) => (
          <VStack
            key={bucket.label}
            flex={1}
            minWidth={0}
            gap={1}
            align="center"
            justify="flex-end"
          >
            <Text
              fontSize="10.5px"
              fontWeight="medium"
              fontVariantNumeric="tabular-nums"
              color={bucket.isEmpty ? FG_MUTED : "fg"}
            >
              {bucket.isEmpty ? "-" : formatPassRate(bucket.passRate)}
            </Text>
            {/* An empty bucket is drawn as a gap, not as a bar of zero: a
                zero-height bar reads as a run that failed completely. */}
            <Box
              width="full"
              maxWidth="26px"
              borderTopRadius="sm"
              height={`${bucket.isEmpty ? 3 : Math.max(((bucket.passRate ?? 0) / 100) * CHART_BAR_MAX, 3)}px`}
              background={
                bucket.isEmpty ? "border" : passRateColor(bucket.passRate)
              }
            />
          </VStack>
        ))}
      </HStack>

      <HStack gap={1.5} marginTop={1}>
        {buckets.map((bucket) => (
          <Text
            key={bucket.label}
            flex={1}
            minWidth={0}
            fontSize="10px"
            color={FG_MUTED}
            textAlign="center"
            truncate
          >
            {bucket.label}
          </Text>
        ))}
      </HStack>
    </VStack>
  );
}

/**
 * What a cost total covers, in words.
 *
 * Null when every row's cost is known, because then the total is the total and
 * a coverage line would only add doubt.
 */
export function costCoverageNote(cost: AtomCost): string | null {
  if (cost.unknownAtoms === 0) return null;
  const total = cost.knownAtoms + cost.unknownAtoms;
  return `across ${cost.knownAtoms} of ${total} runs`;
}

export type ResultsChartsBlockProps = {
  totals: ResultTotals;
  buckets: SeriesBucket[];
};

export function ResultsChartsBlock({
  totals,
  buckets,
}: ResultsChartsBlockProps) {
  return (
    <Grid
      gap={3}
      alignItems="stretch"
      gridTemplateColumns={{
        base: "repeat(2, minmax(0, 1fr))",
        lg: "repeat(4, minmax(0, 1fr))",
        xl: "repeat(4, minmax(0, 1fr)) minmax(300px, 1.5fr)",
      }}
      data-testid="agent-testing-results-charts"
    >
      <Stat
        label="Executions"
        value={String(totals.executions)}
        testId="results-stat-executions"
      />
      <Stat
        label="Pass rate"
        value={formatPassRate(totals.passRate)}
        color={passRateColor(totals.passRate)}
        testId="results-stat-pass-rate"
      />
      <Stat
        label="Failing scenarios"
        value={String(totals.failingScenarios)}
        color={totals.failingScenarios > 0 ? "red.fg" : undefined}
        testId="results-stat-failing"
      />
      <Stat
        label="Cost"
        value={formatCost(totals.cost.totalUsd)}
        note={costCoverageNote(totals.cost)}
        testId="results-stat-cost"
      />
      <PassRateOverTimeChart buckets={buckets} />
    </Grid>
  );
}
