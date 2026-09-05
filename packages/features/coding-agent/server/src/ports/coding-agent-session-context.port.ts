import type { SessionWorkingContext } from "@langwatch/coding-agent-contract";

/**
 * The durable "context the session last declared" the contribute command stamps fact rows
 * from.
 */
export abstract class CodingAgentSessionContextMemoPort {
  /** The one key shape both memo adapters store a session's context under. */
  static memoKey({ tenantId, sessionId }: { tenantId: string; sessionId: string }): string {
    return `coding-agent:session-context:${tenantId}:${sessionId}`;
  }

  abstract tryGet(params: {
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
