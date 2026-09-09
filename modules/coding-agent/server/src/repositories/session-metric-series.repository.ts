import type { CodingAgentSessionMetricSeriesRecord } from "@langwatch/coding-agent-contract";

/** One converged metric bucket from the session metric-series projection. */
export type SessionMetricTotal = {
  sessionId: string;
  metricName: string;
  bucket: string;
  total: number;
};

/** Private persistence port for metric-only session overlays. */
export abstract class SessionMetricSeriesRepository {
  abstract ensure(
    records: CodingAgentSessionMetricSeriesRecord[],
    retentionDays: number,
  ): Promise<void>;

  abstract findTotalsBySessionIds(input: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]>;
}

export class NullSessionMetricSeriesRepository extends SessionMetricSeriesRepository {
  async ensure(): Promise<void> {}

  async findTotalsBySessionIds(): Promise<SessionMetricTotal[]> {
    return [];
  }
}
