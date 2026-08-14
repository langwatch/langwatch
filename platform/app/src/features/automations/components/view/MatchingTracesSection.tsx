import { Box, Button, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { describeError } from "~/features/errors";
import { api } from "~/utils/api";
import { formatMilliseconds } from "~/utils/formatMilliseconds";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

/** How far back the on-demand run looks. The composer's live preview uses the
 *  same window, so the two answers agree. */
const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MATCH_SORT = { columnId: "time", direction: "desc" as const };
const MATCH_PAGE_SIZE = 5;

const STATUS_DOT_COLOR: Record<string, string> = {
  ok: "green.solid",
  error: "red.solid",
  warning: "orange.solid",
};

/**
 * Run this automation's conditions against recent traces, on demand.
 *
 * The composer answers "what would this match?" while you are writing the
 * query; a saved automation had no way to ask the same question, which is
 * what made a quiet automation unexplainable. This runs the automation's own
 * saved query text over the last 7 days, from its own view.
 *
 * It is a strong indication, not a proof of what the automation did: this is
 * the traces search (ClickHouse over stored traces), while the dispatcher
 * evaluates the same query text in memory against fold state as each trace
 * settles. The two can disagree — a field that was unevaluable at dispatch
 * time fails closed there and is simply searchable here, and a trace that has
 * since fallen outside retention is missing here but was acted on then.
 *
 * Deliberately not automatic: a saved automation's view should not issue a
 * trace search every time it is opened. The reader asks, and gets an answer.
 */
export function MatchingTracesSection({
  projectId,
  query,
}: {
  projectId: string;
  /** The automation's trace search query. */
  query: string;
}) {
  const [hasRun, setHasRun] = useState(false);
  // Anchored when the reader asks, not on every render: a window that slides
  // under the result would make two glances at the same panel disagree.
  const [timeRange, setTimeRange] = useState(() => {
    const to = Date.now();
    return { from: to - MATCH_WINDOW_MS, to };
  });

  const matches = api.tracesV2.list.useQuery(
    {
      projectId,
      timeRange,
      sort: MATCH_SORT,
      page: 1,
      pageSize: MATCH_PAGE_SIZE,
      query,
    },
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
            const to = Date.now();
            setTimeRange({ from: to - MATCH_WINDOW_MS, to });
            // Re-anchoring the window changes the query key, and the key
            // change is the refetch — no explicit one needed.
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
          {describeError({
            error: matches.error,
            fallbackTitle: "Couldn't check matching traces",
          })}
        </Text>
      ) : null}
      {matches.data ? <MatchResults data={matches.data} /> : null}
    </VStack>
  );
}

interface MatchedTrace {
  traceId: string;
  name: string;
  timestamp: number;
  durationMs: number;
  status: string;
  input: string | null;
  output: string | null;
}

function MatchResults({
  data,
}: {
  data: { totalHits: number; items: MatchedTrace[] };
}) {
  if (data.totalHits === 0) {
    return (
      <Text textStyle="sm" color="fg.muted">
        Nothing matched in the last 7 days. This automation only acts on traces
        that match its conditions, so it stays quiet until one does.
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

/**
 * One matched trace: what it was, when, and enough of what went in and came
 * out to recognise it. The excerpts come from the same read the traces table
 * uses, so a viewer who may not see captured content sees none here either.
 */
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
        <Text
          textStyle="xs"
          color="fg.muted"
          flexShrink={0}
          whiteSpace="nowrap"
        >
          {trace.durationMs > 0
            ? `${formatMilliseconds(trace.durationMs)} · `
            : ""}
          {formatTimeAgo(trace.timestamp)}
        </Text>
      </HStack>
      <Text
        textStyle="2xs"
        color="fg.subtle"
        fontFamily="mono"
        truncate
        maxWidth="full"
      >
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
