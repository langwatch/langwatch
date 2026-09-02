/**
 * The borderless line under the cases table: when the whole set last ran, and
 * how it did on the far right.
 *
 * @see specs/features/agent-testing/cases-table.feature
 */

import { HStack, Text } from "@chakra-ui/react";
import { format } from "date-fns";
import { RunMetricsSummary } from "@langwatch/suite-web";
import { FG_MUTED } from "../shared/design";
import type { AgentTestingSelection } from "../useAgentTestingRouting";
import type { CaseLastResult } from "./CasesTable";
import {
  type CaseGroup,
  lastRunAtOf,
  summaryFromLastResults,
} from "./test-cases";

/** What the line reads for the All test cases view. */
export const ALL_CASES_LAST_RUN_LABEL = "Last full run at";
/** What it reads for one test suite. */
export const SUITE_LAST_RUN_LABEL = "Last run on";

export type LastRunLineProps = {
  selection: AgentTestingSelection;
  groups: CaseGroup[];
  lastResults: Map<string, CaseLastResult>;
};

export function LastRunLine({
  selection,
  groups,
  lastResults,
}: LastRunLineProps) {
  const results = groups
    .flatMap((group) => group.cases)
    .map((testCase) => lastResults.get(testCase.id))
    .filter((result): result is CaseLastResult => !!result);

  if (results.length === 0) return null;

  const lastRunAt = lastRunAtOf(results);
  const label =
    selection.kind === "all" ? ALL_CASES_LAST_RUN_LABEL : SUITE_LAST_RUN_LABEL;

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
        {label} {lastRunAt ? format(lastRunAt, "MMM d, HH:mm") : "-"}
      </Text>
      <RunMetricsSummary summary={summaryFromLastResults(results)} />
    </HStack>
  );
}
