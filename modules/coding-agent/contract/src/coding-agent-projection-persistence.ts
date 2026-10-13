import type {
  CodingAgentSession,
  CodingAgentSessionEventRecord,
  CodingAgentSessionMetricSeriesRecord,
  CodingAgentTraceSessionRecord,
} from "./coding-agent.ts";

/** A stored session read: the row with its applied event ids, or a miss the fold starts from. */
export type CodingAgentSessionLookup =
  | { kind: "hit"; row: CodingAgentSession; appliedEventIds: string[] }
  | { kind: "miss" };

/** Process-lifecycle port used by Coding Agent's durable event projections. */
export abstract class CodingAgentProjectionPersistence {
  abstract storeSession(input: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }): Promise<void>;

  abstract storeSessionBatch(
    rows: {
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }[],
  ): Promise<void>;

  abstract loadSessionWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<CodingAgentSessionLookup>;

  abstract appendTraceSessions(
    records: CodingAgentTraceSessionRecord[],
    retentionDays: number,
  ): Promise<void>;

  abstract appendMetricSeries(
    records: CodingAgentSessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void>;

  abstract appendSessionEvents(
    records: CodingAgentSessionEventRecord[],
    retentionDays: number,
  ): Promise<void>;
}
