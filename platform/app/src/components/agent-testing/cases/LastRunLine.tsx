/**
 * The borderless line under the cases table: when the open suite last ran, and
 * how it did on the far right.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { HStack, Text } from "@chakra-ui/react";
import { format } from "date-fns";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import { FG_MUTED } from "../shared/design";
import type { CaseLastResult } from "./CasesTable";
import { lastRunAtOf, summaryFromLastResults, type TestCase } from "./test-cases";

/** What the line reads before the date. */
export const SUITE_LAST_RUN_LABEL = "Last run on";

export type LastRunLineProps = {
  cases: TestCase[];
  lastResults: Map<string, CaseLastResult>;
};

export function LastRunLine({ cases, lastResults }: LastRunLineProps) {
  const results = cases
    .map((testCase) => lastResults.get(testCase.id))
    .filter((result): result is CaseLastResult => !!result);

  if (results.length === 0) return null;

  const lastRunAt = lastRunAtOf(results);

  return (
    <HStack
      gap={3}
      rowGap={2}
      flexWrap="wrap"
      justify="flex-end"
      paddingX={1}
      paddingTop={6}
      data-testid="cases-last-run-line"
    >
      <Text fontSize="12px" color={FG_MUTED}>
        {SUITE_LAST_RUN_LABEL}{" "}
        {lastRunAt ? format(lastRunAt, "MMM d, HH:mm") : "-"}
      </Text>
      <RunMetricsSummary summary={summaryFromLastResults(results)} />
    </HStack>
  );
}
