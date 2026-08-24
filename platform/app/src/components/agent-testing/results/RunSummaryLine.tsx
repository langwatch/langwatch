/**
 * The one line above the results: which run this is, how long ago it started,
 * the note it carries, and how it went.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 * @see specs/suites/run-notes.feature
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { RunMetricsSummary } from "~/components/suites/RunMetricsSummary";
import type { RunGroupSummary } from "~/components/suites/run-history-transforms";

export type RunSummaryLineProps = {
  title: string;
  timeAgo: string;
  note: string | null;
  summary: RunGroupSummary | null;
};

export function RunSummaryLine({
  title,
  timeAgo,
  note,
  summary,
}: RunSummaryLineProps) {
  return (
    <HStack gap={2.5} flexWrap="wrap" data-testid="run-summary-line">
      <Text fontSize="sm" fontWeight="semibold">
        {title}
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {timeAgo}
      </Text>
      {note ? (
        <Text
          fontSize="xs"
          color="fg.muted"
          fontStyle="italic"
          truncate
          title={note}
          data-testid="run-summary-note"
        >
          {note}
        </Text>
      ) : null}
      <Box flex={1} />
      {summary ? <RunMetricsSummary summary={summary} /> : null}
    </HStack>
  );
}
