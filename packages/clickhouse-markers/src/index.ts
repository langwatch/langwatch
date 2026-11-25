/**
 * Each table's partition key a grant's window applies to: `OccurredAt` trace_summaries and
 * trace_analytics, `StartTime` stored_spans, `ScheduledAt` evaluation_runs, `Timestamp` logs,
 * `StartedAt` coding_agent_sessions, `BucketStart` the trace and evaluation minute rollups.
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

/**
 * Which statement parameter narrows the fence's held-trace semi-join (ADR-201 §3): the read's
 * trace id, or the millisecond lower bound of its own `StartTime` window.
 */
export type HeldTraceBound = { traceId: string } | { sinceMs: string };

/**
 * ADR-201 §3: the fence with each braid's condition applied, on a span read's outer select only,
 * and owner spans kept to traces the reader holds. Name the read's trace id or `since` parameter
 * so the semi-join reads no wider than the outer read.
 */
export function tenantScopeWithConditions(
  column: TenantScopeTimeColumn,
  held?: HeldTraceBound,
): string {
  if (held === undefined) return `{{tenantScopeWithConditions:${column}}}`;
  const bound = "traceId" in held ? `traceId=${held.traceId}` : `sinceMs=${held.sinceMs}`;
  return `{{tenantScopeWithConditions:${column}:${bound}}}`;
}

/**
 * The latest-version election's marker: tenants and windows alone, so a condition applies after
 * the latest version is chosen. Accepted only as `(TenantId, TraceId, SpanId, UpdatedAt) IN (SELECT
 * TenantId, TraceId, SpanId, max(UpdatedAt) FROM stored_spans WHERE <here>` in a fenced WHERE.
 */
export function tenantScopeForLatestVersion(column: TenantScopeTimeColumn): string {
  return `{{tenantScopeForLatestVersion:${column}}}`;
}
