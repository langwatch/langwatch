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
  /** One write for every record, all of one organization; an empty list writes nothing. */
  abstract insert(input: {
    records: readonly TraceMeterRecord[];
    organizationId: string;
  }): Promise<void>;
  /** Distinct traces of the organization's projects whose first span arrived in the month. */
  abstract findTotal(input: { organizationId: string; month: string }): Promise<number>;
  /** {@link findTotal} per named project; a project with no trace is absent from the answer. */
  abstract countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]>;
}
