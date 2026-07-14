import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";
import { api } from "~/utils/api";
import { SessionView } from "./SessionView";

interface SessionTabProps {
  projectId: string;
  traceId: string;
  /** Partition-pruning hint — without it the read scans every partition. */
  occurredAtMs?: number;
  /**
   * The trace's conversation id. A coding-agent SESSION isn't always one
   * trace — passing this lets the read merge every trace that shares it
   * (the same id `conversationContext` uses) instead of showing only
   * whichever trace happens to be open.
   */
  conversationId?: string | null;
}

/**
 * The Session tab's data boundary.
 *
 * A point read of the pre-folded row(s) (ADR-041) for every trace in this
 * session, merged. The aggregation WITHIN a trace already happened at
 * ingest, which is the whole reason the projection exists — the alternative
 * is every reader (the app, the CLI, the MCP server) re-walking hundreds of
 * spans to count the same things.
 */
export function SessionTab({
  projectId,
  traceId,
  occurredAtMs,
  conversationId,
}: SessionTabProps) {
  const query = api.tracesV2.codingAgentSession.useQuery(
    { projectId, traceId, occurredAtMs, conversationId: conversationId ?? undefined },
    { refetchOnWindowFocus: false, staleTime: 60_000 },
  );
  // The token timeline reflects the trace currently open, not (yet) every
  // trace the merged session above spans — stitching a transcript across
  // sibling traces is a reasonable follow-up, not done here. Shares its
  // cache key with the Terminal tab's own read, so switching tabs on a
  // session already opened once costs nothing extra.
  const transcriptQuery = api.tracesV2.codingAgentTranscript.useQuery(
    { projectId, traceId, occurredAtMs },
    { refetchOnWindowFocus: false, staleTime: 60_000, enabled: !!query.data },
  );

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

  // Null is the NORMAL answer for an ordinary LLM trace: the fold writes no row
  // for one. The tab is only offered for coding-agent traces, so landing here
  // means the session hasn't finished folding yet — say that, rather than
  // showing an empty screen that reads as "nothing happened".
  if (!query.data) {
    return (
      <Centered>
        <VStack gap={1}>
          <Text textStyle="sm" color="fg.muted">
            No usage summary yet
          </Text>
          <Text textStyle="xs" color="fg.subtle">
            It appears shortly after the run finishes.
          </Text>
        </VStack>
      </Centered>
    );
  }

  return <SessionView session={query.data} entries={transcriptQuery.data?.entries} />;
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
