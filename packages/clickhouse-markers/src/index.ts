/**
 * The time columns a marker may name, each a table's own partition key a shared grant's
 * window applies to: `OccurredAt` trace_summaries, `StartTime` stored_spans, `ScheduledAt`
 * evaluation_runs, `Timestamp` logs, `StartedAt` coding_agent_sessions.
 */
export const TENANT_SCOPE_TIME_COLUMNS = [
  "OccurredAt",
  "StartTime",
  "ScheduledAt",
  "Timestamp",
  "StartedAt",
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
