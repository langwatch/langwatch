import { Box, HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";

import { useTraceQueryArgs } from "../../../../../behavior/explorer/use-trace-query-args.ts";
import { useCodingAgentSession } from "../../../../../behavior/reads/use-coding-agent-reads.ts";
import { SessionView } from "../../../../elements/coding-agent/trace/session-view.tsx";
import { useSessionTranscript } from "./use-session-transcript.ts";

interface SessionTabProps {
  projectId: string;
  traceId: string;
  /** Partition-pruning hint for the transcript read. */
  occurredAtMs?: number;
  /** The agent's session id, which every turn of the session shares; null outside one. */
  conversationId: string | null;
}

/**
 * The Session tab's data boundary.
 */
export function SessionTab({ projectId, traceId, occurredAtMs, conversationId }: SessionTabProps) {
  const query = useCodingAgentSession({ projectId, traceId });
  // The chart draws every turn of the session, as the cards above count it.
  const { tenantId } = useTraceQueryArgs();
  const transcript = useSessionTranscript({
    projectId,
    tenantId: tenantId ?? null,
    traceId,
    occurredAtMs,
    conversationId,
    enabled: !!query.data,
  });

  if (query.isLoading) return <SessionSkeleton />;

  if (query.isError) {
    return (
      <Centered>
        <Text textStyle="sm" color="fg.error">
          Couldn&apos;t load usage for this trace
        </Text>
      </Centered>
    );
  }

  // Null is the NORMAL answer for an ordinary LLM trace: the fold writes no row for
  // one.
  if (!query.data) {
    return (
      <Centered>
        <VStack gap={1}>
          <Text textStyle="sm" color="fg.muted">
            No usage summary for this session
          </Text>
          <Text textStyle="xs" color="fg.subtle">
            Claude Code sessions get one shortly after the run finishes. Other coding agents are not
            summarized yet.
          </Text>
        </VStack>
      </Centered>
    );
  }

  return <SessionView session={query.data} entries={transcript.entries} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <VStack align="center" justify="center" height="full" padding={8}>
      {children}
    </VStack>
  );
}

/**
 * Shaped like the screen it precedes — a stat row, then findings, then sections.
 * A generic spinner here would relayout the moment the data lands; this settles
 * into place instead.
 */
function SessionSkeleton() {
  return (
    <VStack align="stretch" gap={6} padding={5}>
      <HStack gap={3}>
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} height="60px" flex={1} borderRadius="md" />
        ))}
      </HStack>
      <Skeleton height="56px" borderRadius="md" />
      <VStack align="stretch" gap={2.5}>
        <Skeleton height="12px" width="120px" />
        <Skeleton height="24px" />
      </VStack>
      <VStack align="stretch" gap={2.5}>
        <Skeleton height="12px" width="140px" />
        <Skeleton height="8px" />
        <Skeleton height="16px" width="60%" />
      </VStack>
      <VStack align="stretch" gap={2.5}>
        <Skeleton height="12px" width="80px" />
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} height="14px" />
        ))}
      </VStack>
      <Box />
    </VStack>
  );
}
