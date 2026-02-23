import { generateClickHouseFilterConditions } from "./filter-conditions";
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
 * Build common WHERE conditions for evaluation_runs queries.
 */
export function buildEvaluationRunsConditions(
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

/**
 * Build scope conditions from filter parameters for scoping query results.
 * Returns SQL fragment and prefixed parameters to avoid collisions.
 *
 * @param params - Query parameters including optional scopeFilters
 * @param scopeParamPrefix - Prefix for parameter names (default: "scope")
 * @returns Object with sql fragment and prefixed params
 */
export function buildScopeConditions(
  params: ClickHouseFilterQueryParams,
  scopeParamPrefix: string = "scope",
): { sql: string; params: Record<string, unknown> } {
  if (!params.scopeFilters || Object.keys(params.scopeFilters).length === 0) {
    return { sql: "", params: {} };
  }

  const result = generateClickHouseFilterConditions(params.scopeFilters);

  if (result.conditions.length === 0) {
    return { sql: "", params: {} };
  }

  // Prefix params to avoid collisions with main query params
  const prefixedParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(result.params)) {
    prefixedParams[`${scopeParamPrefix}_${key}`] = value;
  }

  // Prefix param references in SQL - sort by length desc for safety
  // to ensure longer keys are processed first (avoids partial replacements)
  let sql = result.conditions.join(" AND ");
  const sortedKeys = Object.keys(result.params).sort(
    (a, b) => b.length - a.length,
  );
  for (const key of sortedKeys) {
    sql = sql.replaceAll(`{${key}:`, `{${scopeParamPrefix}_${key}:`);
  }

  return { sql: `AND ${sql}`, params: prefixedParams };
}
