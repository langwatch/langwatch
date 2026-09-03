import type { SessionWorkingContext } from "@langwatch/coding-agent-contract";

/**
 * The durable "context the session last declared" the contribute command
 * stamps fact rows from.
 *
 * Correctness leans on the pipeline's own ordering guarantee, not on this
 * store: contributions are keyed per session, one session is one queue group,
 * and coalescing preserves the group's order. So within a session, every `set`
 * happens-before the `get`s of the records that follow it, and the memo never
 * races itself.
 *
 * A missing answer (expired key, flushed Redis, a session that never declared)
 * produces an unstamped row, which the usage read prices under the legacy
 * whole-session rule — degraded attribution, never lost tokens.
 */
export abstract class CodingAgentSessionContextMemoPort {
  abstract get(params: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null>;
  abstract set(params: {
    tenantId: string;
    sessionId: string;
    context: SessionWorkingContext;
  }): Promise<void>;
}

/**
 * Matches `USAGE_SESSION_WINDOW_MS`: a session older than the usage read's own
 * window prices nothing, so its memo has nothing left to stamp for.
 */
export const SESSION_CONTEXT_MEMO_TTL_SECONDS = 180 * 24 * 60 * 60;

export const sessionContextMemoKey = ({
  tenantId,
  sessionId,
}: {
  tenantId: string;
  sessionId: string;
}): string => `coding-agent:session-context:${tenantId}:${sessionId}`;
