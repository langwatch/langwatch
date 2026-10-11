/** One trace seen in one project's UTC month. */
export interface TraceUsageRow {
  projectId: string;
  traceId: string;
  /** `YYYY-MM`. */
  month: string;
}

/**
 * The `usage_trace_meter` table: one row per trace, project and month, keyed by organization so
 * private instances keep their cluster. Writing a trace twice collapses on the key.
 */
export abstract class TraceCountRepository {
  /** Writes every row under one organization; an empty list writes nothing. */
  abstract insert(input: { organizationId: string; rows: readonly TraceUsageRow[] }): Promise<void>;
  /** Distinct traces first seen in the month across the organization's projects. */
  abstract findTotal(input: { organizationId: string; month: string }): Promise<number>;
  /** {@link findTotal} per named project; a project with no trace is absent from the answer. */
  abstract countByProjects(input: {
    organizationId: string;
    projectIds: readonly string[];
    month: string;
  }): Promise<{ projectId: string; count: number }[]>;
}
