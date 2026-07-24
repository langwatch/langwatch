import { Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { api } from "~/utils/api";
import { deriveSessionBanner } from "./sessionBanner";
import { indexToolSpansBySpanId } from "./toolSpans";
import { TERMINAL_TOKENS } from "./palette";
import { TerminalSkeleton } from "./TerminalSkeleton";
import { TerminalView } from "./TerminalView";

interface TerminalTabProps {
  projectId: string;
  traceId: string;
  /** Partition-pruning hint for the span read. */
  occurredAtMs?: number;
  /** The trace's own name, shown in the bottom bar. */
  sessionName?: string | null;
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
 */
export function TerminalTab({
  projectId,
  traceId,
  occurredAtMs,
  sessionName,
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
  // The version/model/repo Claude Code itself would print above the prompt.
  // Sourced from the resource attributes rather than the coding-agent-session
  // fold: that fold is a bounded aggregate (ADR-041) and deliberately doesn't
  // carry identity strings the drawer already has a dedicated read for.
  const resourceQuery = api.tracesV2.resourceInfo.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );

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

  // The loading state has to look like a terminal too — see TerminalSkeleton.
  if (transcriptQuery.isLoading) {
    return <TerminalSkeleton />;
  }

  if (transcriptQuery.isError) {
    return (
      <VStack
        align="center"
        justify="center"
        height="full"
        bg={TERMINAL_TOKENS.screenBg}
      >
        <Text textStyle="xs" color="fg.error" fontFamily="mono">
          Couldn&apos;t load this session&apos;s transcript
        </Text>
      </VStack>
    );
  }

  return (
    <TerminalView
      entries={transcriptQuery.data?.entries ?? []}
      toolSpans={toolSpans}
      banner={banner}
      sessionName={sessionName}
    />
  );
}
