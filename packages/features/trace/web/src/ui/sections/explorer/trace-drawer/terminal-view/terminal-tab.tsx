import { Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import type { TranscriptEntry } from "@langwatch/coding-agent-contract";
import { api } from "../../../trace-api";
import {
  deriveSessionBanner,
  indexToolSpansBySpanId,
  TERMINAL_TOKENS,
  TerminalSkeleton,
  TerminalView,
} from "@langwatch/coding-agent-web";
import { useSessionScrollback } from "./use-session-scrollback";

/** Stable identity while the transcript is still in flight. */
const NO_ENTRIES: TranscriptEntry[] = [];

interface TerminalTabProps {
  projectId: string;
  traceId: string;
  /** Partition-pruning hint for the span read. */
  occurredAtMs?: number;
  /** The trace's own name, shown in the bottom bar. */
  sessionName?: string | null;
  /**
   * The agent's session id: the other turns of this session are the traces
   * that share it. Null on a trace that belongs to no session, which is what
   * limits the view to the one turn it opened on.
   */
  conversationId: string | null;
}

/**
 * The Terminal tab's data boundary.
 *
 * Reads the WHOLE session's transcript from the backend (`codingAgentTranscript`
 * — spans and logs, ordered by timestamp) rather than rebuilding it in the
 * browser from the last model call's rolling message history. That rebuild
 * only ever showed the final turn, and collapsed entirely when the final call
 * was a lone tool request with no reply text.
 *
 * The transcript's `tool` entries carry only what got recorded generically;
 * the tools' REAL I/O (Bash stdout, a file's content, Edit's structured patch)
 * rides on `tool.output` span events, which are fetched alongside and joined
 * in by span id.
 *
 * A trace is one TURN of a session, so the reads above cover the turn the
 * drawer opened on. The rest of the session sits in its sibling traces, and
 * `useSessionScrollback` walks backwards into them as the reader scrolls up.
 */
export function TerminalTab({
  projectId,
  traceId,
  occurredAtMs,
  sessionName,
  conversationId,
}: TerminalTabProps) {
  const transcriptQuery = api.tracesV2.codingAgentTranscript.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

  const spansQuery = api.tracesV2.spansFull.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  const eventsQuery = api.tracesV2.traceEvents.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  // The version/model/repo Claude Code itself would print above the prompt,
  // off the resource attributes (the session fold deliberately carries no
  // identity strings, ADR-041).
  const resourceQuery = api.tracesV2.resourceInfo.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  const sessionCostUsd = useSessionCostUsd({ projectId, traceId });

  const toolSpans = useMemo(
    () =>
      indexToolSpansBySpanId({
        spans: spansQuery.data ?? [],
        events: eventsQuery.data ?? [],
      }),
    [spansQuery.data, eventsQuery.data],
  );

  const banner = useMemo(
    () =>
      deriveSessionBanner({
        resourceAttributes: resourceQuery.data?.resourceAttributes ?? {},
        spans: spansQuery.data ?? [],
      }),
    [resourceQuery.data, spansQuery.data],
  );

  const session = useSessionScrollback({
    projectId,
    traceId,
    occurredAtMs,
    conversationId,
    openedTranscript: transcriptQuery.data?.entries ?? NO_ENTRIES,
    openedToolSpans: toolSpans,
  });
  const scrollback = useMemo(
    () => ({
      status: session.status,
      earlierCount: session.earlierCount,
      onLoadEarlier: session.loadEarlier,
    }),
    [session.status, session.earlierCount, session.loadEarlier],
  );

  // The loading state has to look like a terminal too — see TerminalSkeleton.
  if (transcriptQuery.isLoading) {
    return <TerminalSkeleton />;
  }

  if (transcriptQuery.isError) {
    return <TranscriptError />;
  }

  return (
    <TerminalView
      entries={session.entries}
      rowKeys={session.rowKeys}
      toolSpans={session.toolSpans}
      turnDividers={session.turnDividers}
      scrollback={scrollback}
      earlierTotals={session.earlierTotals}
      sessionStartAtMs={session.sessionStartAtMs}
      sessionCostUsd={sessionCostUsd}
      banner={banner}
      sessionName={sessionName}
    />
  );
}

function TranscriptError() {
  return (
    <VStack align="center" justify="center" height="full" bg={TERMINAL_TOKENS.screenBg}>
      <Text textStyle="xs" color="fg.error" fontFamily="mono">
        Couldn&apos;t load this session&apos;s transcript
      </Text>
    </VStack>
  );
}

/**
 * The whole session's cost for the bottom bar, off the same pre-folded row
 * the Usage tab reads (and the same query, so opening both tabs fetches
 * once). The replay walks backward only and its turn list is bounded, so the
 * bar's running figure alone understates any session bigger than what loaded
 * — stating this total beside it is what keeps a position-scoped number from
 * passing for the session total.
 */
function useSessionCostUsd({
  projectId,
  traceId,
}: {
  projectId: string;
  traceId: string;
}): number | null {
  const sessionQuery = api.tracesV2.codingAgentSession.useQuery(
    { projectId, traceId },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  return sessionQuery.data?.costUsd ?? null;
}
