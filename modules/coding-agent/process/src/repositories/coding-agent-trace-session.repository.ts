/** Private persistence port for the trace-to-session projection. */
import type { CodingAgentTraceSessionRecord } from "@langwatch/coding-agent-contract";

export abstract class CodingAgentTraceSessionRepository {
  abstract ensure(records: CodingAgentTraceSessionRecord[], retentionDays: number): Promise<void>;

  abstract findByTraceId(input: {
    tenantId: string;
    traceId: string;
  }): Promise<CodingAgentTraceSessionRecord | null>;

  /** The session's traces inside the window, newest first, one per trace, at most `limit`. */
  abstract findRecentBySessionId(input: {
    tenantId: string;
    sessionId: string;
    fromMs: number;
    toMs: number;
    limit: number;
  }): Promise<CodingAgentTraceSessionRecord[]>;
}
