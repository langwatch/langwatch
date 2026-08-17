import { createLogger } from "@langwatch/observability";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionManagedTable,
} from "~/server/data-retention/retentionPolicy.schema";
import type { RetentionPolicyResolver } from "~/server/data-retention/retentionPolicyResolver";

const logger = createLogger("langwatch:clickhouse:retention-floor");

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Slack added below the retention horizon.
 *
 * TTL deletion is asynchronous — a row past its retention is eligible for
 * removal, not already gone — and the floor is compared against a column
 * (ScheduledAt, OccurredAt) whose clock is the producer's, not ours. Two days
 * covers both without meaningfully widening the partition range.
 */
export const RETENTION_FLOOR_MARGIN_MS = 2 * DAY_MS;

/**
 * The oldest timestamp a read of `table` for `tenantId` can still find a row at.
 *
 * Every retention-managed table is partitioned on its time column, so a query
 * with no lower bound prunes nothing and walks every partition — including the
 * cold ones on S3. That is the difference between a keyed seek and a scan of
 * the entire history, and in production it was the single largest source of
 * `coldScan: true` queries: 208 of 300 in one sampled window, all of them
 * `evaluation_runs`.
 *
 * A floor is safe where an unbounded scan is merely expensive: rows older than
 * the tenant's retention are TTL'd away, so a bounded query cannot hide a row
 * the unbounded one would have found. The floor is per tenant on purpose —
 * a project on a long custom retention gets a correspondingly long lookback,
 * and one on a short policy pays for a much smaller range.
 *
 * Resolution failure falls back to the platform default rather than to an
 * unbounded read: the fallback is a policy question, and "scan everything"
 * is the answer that took production down.
 */
export async function resolveRetentionFloorMs({
  table,
  tenantId,
  resolver,
  nowMs = Date.now(),
}: {
  table: RetentionManagedTable;
  tenantId: string;
  /** Omit to use the platform default — every caller need not be rewired at once. */
  resolver?: RetentionPolicyResolver;
  nowMs?: number;
}): Promise<number> {
  const days = await resolveRetentionDays({ table, tenantId, resolver });
  return nowMs - days * DAY_MS - RETENTION_FLOOR_MARGIN_MS;
}

async function resolveRetentionDays({
  table,
  tenantId,
  resolver,
}: {
  table: RetentionManagedTable;
  tenantId: string;
  resolver?: RetentionPolicyResolver;
}): Promise<number> {
  if (!resolver) return PLATFORM_DEFAULT_RETENTION_DAYS;

  const category = RETENTION_TABLE_CATEGORY_MAP[table];
  try {
    const resolved = await resolver.resolve(tenantId);
    const days = resolved?.[category];
    // `resolveRetention` floors every category at the platform default, so a
    // non-positive value here means the cascade could not answer, not that the
    // tenant asked for zero-day retention.
    return typeof days === "number" && days > 0
      ? days
      : PLATFORM_DEFAULT_RETENTION_DAYS;
  } catch (error) {
    logger.warn(
      { tenantId, table, category, error },
      "Retention resolve for read floor failed; using the platform default",
    );
    return PLATFORM_DEFAULT_RETENTION_DAYS;
  }
}
