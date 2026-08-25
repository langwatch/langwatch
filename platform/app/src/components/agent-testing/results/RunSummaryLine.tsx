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
import { FG_MUTED } from "../shared/design";

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
      <Text fontSize="12.5px" fontWeight="semibold">
        {title}
      </Text>
      <Text fontSize="11.5px" color={FG_MUTED}>
        {timeAgo}
      </Text>
      {note ? (
        <Text
          fontSize="11.5px"
          color={FG_MUTED}
          fontStyle="italic"
          truncate
          minWidth={0}
          title={note}
          data-testid="run-summary-note"
        >
          &ldquo;{note}&rdquo;
        </Text>
      ) : null}
      <Box flex={1} />
      <HStack gap={1.5} flexWrap="wrap">
        {summary ? <RunMetricsSummary summary={summary} /> : null}
      </HStack>
    </HStack>
  );
}
