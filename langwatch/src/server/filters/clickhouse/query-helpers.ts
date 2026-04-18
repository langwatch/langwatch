import { generateClickHouseFilterConditions } from "./filter-conditions";
import type { ClickHouseFilterQueryParams, FilterOption } from "./types";

/**
 * Attribute keys as stored in ClickHouse trace_summaries.Attributes map.
 *
 * These must match the canonical keys used by the event-sourcing fold projection.
 * See: src/server/event-sourcing/pipelines/trace-processing/projections/traceSummary.foldProjection.ts
 */
export const ATTRIBUTE_KEYS = {
  thread_id: "Attributes['gen_ai.conversation.id']",
  user_id: "Attributes['langwatch.user_id']",
  customer_id: "Attributes['langwatch.customer_id']",
} as const;

/**
 * Build common WHERE conditions for trace_summaries queries.
 *
 * Includes an IN-tuple dedup clause so we only consider the latest version of
 * each trace (by UpdatedAt) — critical pre-merge, otherwise archived traces
 * leak back via older unarchived rows in the ReplacingMergeTree. Inner dedup
 * subquery intentionally omits ArchivedAt — filtering it there makes
 * max(UpdatedAt) pick a stale version and lets archived traces reappear.
 */
export function buildTraceSummariesConditions(
  _params: ClickHouseFilterQueryParams,
): string {
  const conditions: string[] = [
    "TenantId = {tenantId:String}",
    "ArchivedAt IS NULL",
    "OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})",
    "OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})",
    `(TenantId, TraceId, UpdatedAt) IN (
      SELECT TenantId, TraceId, max(UpdatedAt)
      FROM trace_summaries
      WHERE TenantId = {tenantId:String}
        AND OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64})
        AND OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
      GROUP BY TenantId, TraceId
    )`,
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
