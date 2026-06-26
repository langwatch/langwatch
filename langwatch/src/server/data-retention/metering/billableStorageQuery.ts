import {
  TABLE_TTL_CONFIG,
  buildRetentionAgeColumnExpression,
} from "~/server/clickhouse/ttlReconciler";
import { RETENTION_MANAGED_TABLES } from "../retentionPolicy.schema";

/**
 * Days of free storage a paid plan includes before storage billing accrues
 * (ADR-027). 35 = 5 weeks, a clean `toYearWeek` partition boundary so the age
 * cutoff prunes whole weekly partitions. A default-keep org deletes at the
 * cutoff and therefore bills €0 by construction. The measurement is correct for
 * any cutoff; this is the one named constant the pipeline anchors on.
 */
export const BILLABLE_AFTER_DAYS = 35;

/**
 * Per-managed-table age expression, sourced from the retention TTL config so the
 * billing age predicate is byte-identical to the column the TTL DELETE ages on
 * (e.g. `event_log` is epoch-millis → `toDateTime(EventOccurredAt / 1000)`).
 * Reimplementing the conversion here would let billing diverge from deletion.
 *
 * Restricted to `RETENTION_MANAGED_TABLES`: `billable_events` carries no
 * retention TTL column and is never part of the billable storage surface.
 */
export const BILLABLE_AGE_EXPR_BY_TABLE: Record<string, string> =
  Object.fromEntries(
    TABLE_TTL_CONFIG.filter((config) =>
      (RETENTION_MANAGED_TABLES as readonly string[]).includes(config.table),
    ).map((config) => {
      const ageExpr = buildRetentionAgeColumnExpression(config);
      if (!ageExpr) {
        // Every managed table has a retention TTL column; this guards against a
        // config drift where one loses it without updating the managed list.
        throw new Error(
          `Managed table "${config.table}" has no retention age column expression`,
        );
      }
      return [config.table, ageExpr];
    }),
  );

/**
 * Builds the single per-tenant billable-storage query: each managed table is
 * pre-aggregated to one scalar `sum(_size_bytes)` over rows older than the
 * cutoff, all UNION ALL'd, then summed once in the outer query. Pre-aggregating
 * per table keeps only the per-table scalars (not every row's `_size_bytes`) in
 * the intermediate set — the heavy-payload `byteSize()` recompute that caused
 * the prod OOMs never materializes across the union.
 *
 * Parameterized by `tenantId` (one tenant per query — never a cross-tenant
 * `IN`) and `cutoff` (an explicit `DateTime('UTC')` so the boundary can't shift
 * with the ClickHouse session timezone).
 */
export function buildBillableStorageQuery(
  ageExprByTable: Record<string, string>,
): string {
  const unions = Object.entries(ageExprByTable)
    .map(
      ([table, ageExpr]) =>
        `SELECT sum(_size_bytes) AS t FROM ${table}` +
        ` WHERE TenantId = {tenantId:String}` +
        ` AND ${ageExpr} <= {cutoff:DateTime('UTC')}`,
    )
    .join("\n  UNION ALL\n  ");

  return `SELECT sum(t) AS total FROM (\n  ${unions}\n)`;
}
