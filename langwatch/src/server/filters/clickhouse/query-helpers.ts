import type { ClickHouseFilterQueryParams, FilterOption } from "./types";

/**
 * Attribute keys as stored in ClickHouse trace_summaries.Attributes map.
 *
 * The traceAggregationService reads from canonical span attributes (gen_ai.conversation.id,
 * langwatch.user.id, etc.) but stores them with simplified keys in the trace summary.
 * See: src/server/event-sourcing/pipelines/trace-processing/services/traceAggregationService.ts
 */
export const ATTRIBUTE_KEYS = {
  // Thread ID: stored as "thread.id" (from gen_ai.conversation.id, langwatch.thread_id, etc.)
  thread_id: "Attributes['thread.id']",
  // User ID: stored as "user.id" (from langwatch.user.id, langwatch.user_id, etc.)
  user_id: "Attributes['user.id']",
  // Customer ID: stored as "customer.id" (from langwatch.customer.id, langwatch.customer_id, etc.)
  customer_id: "Attributes['customer.id']",
} as const;

/**
 * Build common WHERE conditions for trace_summaries queries.
 */
export function buildTraceSummariesConditions(
  _params: ClickHouseFilterQueryParams,
): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "CreatedAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "CreatedAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build common WHERE conditions for stored_spans queries.
 */
export function buildStoredSpansConditions(
  _params: ClickHouseFilterQueryParams,
): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build common WHERE conditions for evaluation_states queries.
 */
export function buildEvaluationStatesConditions(
  _params: ClickHouseFilterQueryParams,
): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "ScheduledAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "ScheduledAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
  ];
  return conditions.join(" AND ");
}

/**
 * Build a LIKE filter clause for optional query string matching.
 */
export function buildQueryFilter(
  column: string,
  params: ClickHouseFilterQueryParams,
): string {
  if (!params.query) {
    return "";
  }
  return `AND lower(${column}) LIKE lower(concat({query:String}, '%'))`;
}

/**
 * Standard result extractor for field/label/count rows.
 */
export function extractStandardResults(rows: unknown[]): FilterOption[] {
  return (rows as Array<{ field: string; label: string; count: string }>).map(
    (row) => ({
      field: row.field,
      label: row.label,
      count: parseInt(row.count, 10),
    }),
  );
}
