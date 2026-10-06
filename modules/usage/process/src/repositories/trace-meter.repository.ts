/** One span's trace, as the trace meter projection produces it. */
export interface TraceMeterRecord {
  organizationId: string;
  tenantId: string;
  traceId: string;
  /** `YYYY-MM`, the UTC month the span arrived in. */
  month: string;
}

/** The `usage_trace_meter` table, keyed by organization so private instances keep their cluster. */
export abstract class TraceMeterRepository {
  abstract insert(input: { record: TraceMeterRecord; organizationId: string }): Promise<void>;
  /** Distinct traces of the organization's projects whose first span arrived in the month. */
  abstract findTotal(input: { organizationId: string; month: string }): Promise<number>;
}
