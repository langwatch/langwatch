import { formatMilliseconds } from "@langwatch/design-system/format-milliseconds";
import { Box, Button, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";
import { nowInstant } from "@langwatch/time";
import { useState } from "react";

import { api, type RouterOutputs } from "../../../../behavior/automation-api.ts";
import { useDescribeError } from "../../../../behavior/automation-feedback.ts";
import { formatTimeAgo } from "../../../../model/relative-time.ts";

/** How far back the on-demand run looks; the composer's live preview uses the same window. */
const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MATCH_SORT = { columnId: "time", direction: "desc" as const };
const MATCH_PAGE_SIZE = 5;

const STATUS_DOT_COLOR: Record<string, string> = {
  ok: "green.solid",
  error: "red.solid",
  warning: "orange.solid",
};

const windowEndingNow = () => {
  const to = nowInstant().epochMilliseconds;
  return { from: to - MATCH_WINDOW_MS, to };
};

/*
 * Runs the saved query over the last 7 days, on demand: a strong indication, not proof, since
 * dispatch evaluates it against fold state. Not automatic: opening the view searches nothing.
 */
export function MatchingTracesSection({
  projectId,
  query,
}: {
  projectId: string;
  /** The automation's trace search query. */
  query: string;
}) {
  const describeError = useDescribeError();
  const [hasRun, setHasRun] = useState(false);
  // Anchored when the reader asks, so two glances at the same panel agree.
  const [timeRange, setTimeRange] = useState(windowEndingNow);

  const matches = api.traces.list.useQuery(
    { projectId, timeRange, sort: MATCH_SORT, page: 1, pageSize: MATCH_PAGE_SIZE, query },
    {
      enabled: hasRun && !!projectId && query.trim().length > 0,
      retry: false,
      refetchOnWindowFocus: false,
    },
  );

  return (
    <VStack align="start" gap={2} width="full">
      <Text textStyle="xs" color="fg.muted" fontWeight="medium">
        Recent matches
      </Text>
      <HStack gap={2}>
        <Button
          size="xs"
          variant="outline"
          loading={matches.isFetching}
          onClick={() => {
            // Re-anchoring the window changes the query key, which is the refetch.
            setTimeRange(windowEndingNow());
            setHasRun(true);
          }}
        >
          Run the conditions now
        </Button>
        <Text textStyle="xs" color="fg.muted">
          Checks the last 7 days without sending anything.
        </Text>
      </HStack>
      {matches.isFetching && !matches.data ? (
        <HStack gap={2} color="fg.muted">
          <Spinner size="xs" />
          <Text textStyle="xs">Checking matching traces…</Text>
        </HStack>
      ) : null}
      {matches.error && !matches.data ? (
        <Text textStyle="xs" color="fg.error">
          {describeError({ error: matches.error, fallbackTitle: "Couldn't check matching traces" })}
        </Text>
      ) : null}
      {matches.data ? <MatchResults data={matches.data} /> : null}
    </VStack>
  );
}

type MatchList = RouterOutputs["traces"]["list"];
type MatchedTrace = MatchList["items"][number];

function MatchResults({ data }: { data: MatchList }) {
  if (data.totalHits === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        Nothing matched in the last 7 days. This automation only acts on traces that match its
        conditions, so it stays quiet until one does.
      </Text>
    );
  }
  return (
    <VStack align="stretch" gap={2} width="full">
      <Text textStyle="sm">
        {data.totalHits === 1
          ? "1 trace matched in the last 7 days"
          : `${data.totalHits.toLocaleString()} traces matched in the last 7 days`}
      </Text>
      <VStack
        align="stretch"
        gap={0}
        width="full"
        borderWidth="1px"
        borderColor="border"
        borderRadius="md"
        overflow="hidden"
      >
        {data.items.map((trace) => (
          <MatchedTraceRow key={trace.traceId} trace={trace} />
        ))}
      </VStack>
    </VStack>
  );
}

/** One matched trace; the excerpts come from the traces table's own read and its permissions. */
function MatchedTraceRow({ trace }: { trace: MatchedTrace }) {
  return (
    <VStack
      align="stretch"
      gap={1}
      paddingX={3}
      paddingY={2}
      borderBottomWidth="1px"
      borderColor="border"
      _last={{ borderBottomWidth: 0 }}
    >
      <HStack gap={2.5}>
        <Box
          boxSize={2}
          borderRadius="full"
          flexShrink={0}
          bg={STATUS_DOT_COLOR[trace.status] ?? "gray.solid"}
        />
        <Text textStyle="sm" flex="1" minWidth="0" lineClamp={1}>
          {trace.name || "Trace"}
        </Text>
        <Text textStyle="xs" color="fg.muted" flexShrink={0} whiteSpace="nowrap">
          {trace.durationMs > 0 ? `${formatMilliseconds(trace.durationMs)} · ` : ""}
          {formatTimeAgo(trace.timestamp)}
        </Text>
      </HStack>
      <Text textStyle="2xs" color="fg.subtle" fontFamily="mono" truncate maxWidth="full">
        {trace.traceId}
      </Text>
      {trace.input ? (
        <Text textStyle="xs" color="fg.muted" lineClamp={1}>
          Input: {trace.input}
        </Text>
      ) : null}
      {trace.output ? (
        <Text textStyle="xs" color="fg.muted" lineClamp={1}>
          Output: {trace.output}
        </Text>
      ) : null}
    </VStack>
  );
}
