import { Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { api } from "~/utils/api";
import { buildTerminalStepsFromSpans } from "./buildStepsFromSpans";
import { deriveSessionEvents } from "./sessionEvents";
import { indexToolSpansByUseId } from "./toolSpans";
import { TERMINAL_TOKENS } from "./palette";
import { TerminalSkeleton } from "./TerminalSkeleton";
import { TerminalView } from "./TerminalView";

interface TerminalTabProps {
  projectId: string;
  traceId: string;
  /** Partition-pruning hint for the span read. */
  occurredAtMs?: number;
  cwd?: string;
}

/**
 * The Terminal tab's data boundary.
 *
 * Reads the turn's full spans rather than the trace summary's headline I/O: a
 * Claude Code turn is an agentic loop of many model calls and tool runs, and
 * the summary only ever carries the opening prompt and the closing reply. The
 * spans carry the loop — and their message content + cost are joined on from
 * the trace's OTLP log records server-side (`spansFull`), because Claude's own
 * spans ship tokens without content.
 */
export function TerminalTab({
  projectId,
  traceId,
  occurredAtMs,
  cwd,
}: TerminalTabProps) {
  const query = api.tracesV2.spansFull.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  // The tools' real I/O rides on `tool.output` span events (Bash stdout, a
  // file's content, Edit's structured patch), which `spansFull` doesn't carry.
  // Fetched alongside rather than blocking on: the transcript already has a
  // usable echo of each result, so the screen renders without this and sharpens
  // when it lands.
  const eventsQuery = api.tracesV2.traceEvents.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  const steps = useMemo(
    () => (query.data ? buildTerminalStepsFromSpans(query.data) : []),
    [query.data],
  );
  // A trace is spans AND logs. The logs carry what the spans cannot: a tool the
  // user DENIED (which produces no span at all), API errors and their retries, a
  // mid-session compaction. Read them so the session shows its real moments.
  const logsQuery = api.tracesV2.traceLogs.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  const sessionEvents = useMemo(
    () => deriveSessionEvents(logsQuery.data ?? []),
    [logsQuery.data],
  );

  const toolSpans = useMemo(
    () =>
      indexToolSpansByUseId({
        spans: query.data ?? [],
        events: eventsQuery.data ?? [],
      }),
    [query.data, eventsQuery.data],
  );

  // The loading state has to look like a terminal too — see TerminalSkeleton.
  if (query.isLoading) {
    return <TerminalSkeleton />;
  }

  if (query.isError) {
    return (
      <VStack
        align="center"
        justify="center"
        height="full"
        bg={TERMINAL_TOKENS.screenBg}
      >
        <Text textStyle="xs" color="fg.error" fontFamily="mono">
          Couldn&apos;t load this session&apos;s spans
        </Text>
      </VStack>
    );
  }

  return (
    <TerminalView
      steps={steps}
      toolSpans={toolSpans}
      sessionEvents={sessionEvents}
      meta={{ cwd }}
    />
  );
}
