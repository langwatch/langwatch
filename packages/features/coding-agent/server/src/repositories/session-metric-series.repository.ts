/** One converged metric bucket from the session metric-series projection. */
export type SessionMetricTotal = {
  sessionId: string;
  metricName: string;
  bucket: string;
  total: number;
};

/** Private persistence port for metric-only session overlays. */
export abstract class SessionMetricSeriesRepository {
  abstract findTotalsBySessionIds(input: {
    tenantId: string;
    sessionIds: string[];
    fromMs: number;
    toMs: number;
  }): Promise<SessionMetricTotal[]>;
}
