/**
 * The time columns a marker may name, each a table's partition key a grant's window applies to:
 * `OccurredAt` trace_summaries and trace_analytics, `StartTime` stored_spans, `ScheduledAt`
 * evaluation_runs, `Timestamp` logs, `StartedAt` coding_agent_sessions, `BucketStart` rollups.
 */
export const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
  "StartedAt",
  "BucketStart",
] as const;
export type TenantScopeTimeColumn = (typeof TENANT_SCOPE_TIME_COLUMNS)[number];

/**
 * The width in milliseconds of a column that holds a bucket's start, not an event's time. A
 * bucket holds rows up to its start plus the width, so a window admits only buckets that lie
 * wholly inside it: a bucket a grant's edge cuts through is left out, never counted past it.
 */
export const TENANT_SCOPE_BUCKET_WIDTH_MS: Readonly<
  Partial<Record<TenantScopeTimeColumn, number>>
> = {
  BucketStart: 60_000,
};

/** The marker a repository writes where its tenant predicate used to go. */
export function tenantScope(column: TenantScopeTimeColumn): string {
  return `{{tenantScope:${column}}}`;
}

/**
 * The set-only marker: every tenant the proof names, no window. For a side-table subquery whose
 * timestamp is not the trace's; the statement still needs a `tenantScope` marker for the window.
 */
export function tenantSet(): string {
  return "{{tenantSet}}";
}
