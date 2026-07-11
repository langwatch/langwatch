import { Skeleton, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { api } from "~/utils/api";
import { buildTerminalStepsFromSpans } from "./buildStepsFromSpans";
import { TERMINAL_TOKENS } from "./palette";
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

  const steps = useMemo(
    () => (query.data ? buildTerminalStepsFromSpans(query.data) : []),
    [query.data],
  );

  if (query.isLoading) {
    return (
      <VStack
        align="stretch"
        gap={2}
        padding={4}
        height="full"
        bg={TERMINAL_TOKENS.screenBg}
        aria-busy="true"
        aria-label="Loading terminal session"
      >
        {["70%", "45%", "88%", "62%"].map((width) => (
          <Skeleton key={width} height="12px" width={width} borderRadius="sm" />
        ))}
      </VStack>
    );
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

  return <TerminalView steps={steps} meta={{ cwd }} />;
}
