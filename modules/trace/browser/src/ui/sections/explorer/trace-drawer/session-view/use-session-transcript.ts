import type { TranscriptEntry } from "@langwatch/coding-agent-contract";

import { api } from "../../../../../behavior/trace-api.ts";
import { useConversationContext } from "../../../../../features/conversation/behavior/use-conversation-context.ts";

/** What the Usage tab knows about the turn it opened on. */
interface SessionTranscriptInput {
  projectId: string;
  /** On an aggregate, the member the drawer is on; null on a plain project. */
  tenantId: string | null;
  traceId: string;
  /** Partition-pruning hint for the opened turn's read. */
  occurredAtMs?: number;
  /** The agent's session id, which the session's turns share. */
  conversationId: string | null;
  enabled?: boolean;
}

/** One turn's transcript read: its trace and the partition hint it is read under. */
interface TurnTarget {
  traceId: string;
  occurredAtMs: number | undefined;
}

/**
 * Every turn of the session the opened trace belongs to, or the opened trace alone when the
 * session's turn list does not hold it. The opened turn keeps its own hint.
 */
function turnTargets({
  turns,
  traceId,
  occurredAtMs,
}: {
  turns: { traceId: string; timestamp: number }[];
  traceId: string;
  occurredAtMs: number | undefined;
}): TurnTarget[] {
  if (!turns.some((turn) => turn.traceId === traceId)) return [{ traceId, occurredAtMs }];
  return turns.map((turn) => ({
    traceId: turn.traceId,
    occurredAtMs: turn.traceId === traceId ? occurredAtMs : turn.timestamp,
  }));
}

/**
 * The whole session's transcript for the per-call chart: each turn read in parallel under
 * the key the Terminal tab reads it with, joined in turn order. Undefined until every turn
 * has answered, so the chart never draws a partial session and then grows.
 */
export function useSessionTranscript({
  projectId,
  tenantId,
  traceId,
  occurredAtMs,
  conversationId,
  enabled = true,
}: SessionTranscriptInput): { entries: TranscriptEntry[] | undefined } {
  const { turns, isLoading: isTurnListLoading } = useConversationContext(conversationId, traceId);
  const ready = enabled && !(conversationId && isTurnListLoading);
  const targets = ready ? turnTargets({ turns, traceId, occurredAtMs }) : [];

  const reads = api.useQueries((t) =>
    targets.map((target) =>
      t.codingAgents.transcript({
        projectId,
        traceId: target.traceId,
        occurredAtMs: target.occurredAtMs,
        ...(tenantId ? { tenantId } : {}),
      }),
    ),
  );

  if (!ready || reads.some((read) => read.isPending)) return { entries: undefined };
  return { entries: reads.flatMap((read) => read.data?.entries ?? []) };
}
