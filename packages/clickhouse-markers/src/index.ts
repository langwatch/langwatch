/**
 * The time columns a marker may name: each table's own occurrence time and partition key
 * (`OccurredAt` trace_summaries, `StartTime` stored_spans, `ScheduledAt` evaluation_runs,
 * `Timestamp` logs), since a shared grant's window is applied to it.
 */
export const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
] as const;
export type TenantScopeTimeColumn = (typeof TENANT_SCOPE_TIME_COLUMNS)[number];

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
