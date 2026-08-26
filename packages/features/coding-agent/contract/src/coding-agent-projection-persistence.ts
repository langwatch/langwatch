import type {
  CodingAgentSession,
  CodingAgentSessionEventRecord,
  CodingAgentSessionMetricSeriesRecord,
  CodingAgentTraceSessionRecord,
} from "./coding-agent";

/** Process-lifecycle port used by Coding Agent's durable event projections. */
export abstract class CodingAgentProjectionPersistence {
  abstract storeSession(input: {
    row: CodingAgentSession;
    retentionDays: number;
    appliedEventIds: readonly string[];
  }): Promise<void>;

  abstract storeSessionBatch(
    rows: Array<{
      row: CodingAgentSession;
      retentionDays: number;
      appliedEventIds: readonly string[];
    }>,
  ): Promise<void>;

  abstract loadSessionWithApplied(input: {
    tenantId: string;
    sessionId: string;
    window?: { fromMs: number; toMs: number };
  }): Promise<{
    row: CodingAgentSession;
    appliedEventIds: string[];
  } | null>;

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
