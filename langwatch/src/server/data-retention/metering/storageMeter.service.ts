import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { formatClickHouseDateTime } from "~/server/clickhouse/dateTime";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import {
  RETENTION_MANAGED_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
} from "../retentionPolicy.schema";
import {
  BILLABLE_AFTER_DAYS,
  BILLABLE_AGE_EXPR_BY_TABLE,
  buildBillableStorageQuery,
} from "./billableStorageQuery";

const logger = createLogger("langwatch:data-retention:metering");

const CACHE_TTL_MS = 5 * 60 * 1000;

// Storage metering sums `_size_bytes`, a `UInt32 MATERIALIZED byteSize(...)`
// column over each table's payload columns. On parts written before that
// column existed, ClickHouse has no stored value and recomputes it lazily on
// read by scanning the heavy source columns (Messages.*, Inputs, Details,
// EventPayload, ...). Summing across a large tenant therefore reads those
// payload columns for every row; at the default thread count the parallel
// per-stream column buffers exceeded the per-query memory limit (Code 241,
// e.g. ~6.6 GiB reading column `Inputs` against the 3.5 GiB cap), so the
// metering read failed outright.
//
// These are cached (5 min), background metering reads, so we trade parallelism
// for a bounded peak: capping the read streams keeps the recompute's footprint
// well under the per-query limit so the query succeeds, and lowers its share of
// total server memory so it can't help tip the box into a server-wide OOM. The
// common case (parts where `_size_bytes` is already materialized) reads a tiny
// UInt32 column and is unaffected.
//
// `max_execution_time` is a coarse guardrail on top of that: a materialized
// read finishes in a few seconds even for the largest tenants, so this only
// trips on the pathological recompute path (observed at 24-60s reading tens of
// GB). Tripping it fails that one read — which is then degraded gracefully (see
// getStorageBreakdown's per-table catch and queryTotalBytes's fallback) instead
// of letting one tenant's metering grind for a minute and burn tens of GB of
// reads every cache cycle. The durable fix is to backfill the column so the
// recompute never happens (see queryTotalBytes).
const METERING_MAX_EXECUTION_SECONDS = 45;
const METERING_CLICKHOUSE_SETTINGS = {
  max_threads: 2,
  max_execution_time: METERING_MAX_EXECUTION_SECONDS,
} as const;

// The billable measurement adds an age predicate, which forces a wider scan
// than the cached total (notably `evaluation_runs`, whose retention column
// `UpdatedAt` is not its partition key, so its predicate cannot prune). Keep the
// `max_threads` memory cap and add an execution-time ceiling so a pathological
// tenant query fails fast for the dispatcher to retry rather than hanging a
// connection and starving the box.
const BILLABLE_METERING_CLICKHOUSE_SETTINGS = {
  ...METERING_CLICKHOUSE_SETTINGS,
  max_execution_time: 45,
} as const;

/** Resolves an organization's project ids (its ClickHouse tenant ids). */
export type ProjectIdsResolver = (
  organizationId: string,
) => Promise<string[]>;

// The per-tenant billable query is identical across orgs and hours (only its
// params vary), so build it once at module load rather than per call.
const BILLABLE_STORAGE_QUERY = buildBillableStorageQuery(
  BILLABLE_AGE_EXPR_BY_TABLE,
);

interface StorageBreakdown {
  totalBytes: number;
  byCategory: Record<RetentionCategory, number>;
}

export class StorageMeterService {
  private readonly cache: TtlCache<number>;

  /**
   * @param resolveProjectIds required only by {@link getBillableStorageBytesForOrgAt}
   *   (billing). The retention-UI reads work without it; the OSS construction
   *   omits it because the billing path never runs there.
   */
  constructor(
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
    private readonly resolveProjectIds?: ProjectIdsResolver,
  ) {
    this.cache = new TtlCache(CACHE_TTL_MS, "storage-meter:");
  }

  /**
   * Total stored bytes for a tenant across all retention-managed tables,
   * served from a short-lived cache and computed via {@link queryTotalBytes}
   * on a miss.
   */
  async getTotalStorageBytes({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<number> {
    const cached = await this.cache.get(tenantId);
    if (cached !== undefined) return cached;

    const total = await this.queryTotalBytes(tenantId);
    await this.cache.set(tenantId, total);
    return total;
  }

  /**
   * Logical (uncompressed `_size_bytes`) stored bytes an organization holds
   * that are older than the free window, as of a sealed hour `H` (never `now()`)
   * — the billable storage surface for ADR-027.
   *
   * Anchored to `H`: the cutoff is `H − {@link BILLABLE_AFTER_DAYS}` days, bound
   * as an explicit UTC value, so the result is reproducible regardless of when
   * it runs or the ClickHouse session timezone. Summed across the org's projects
   * one tenant-routed query at a time — never a cross-tenant `IN` scan, which
   * multiplies the heavy `byteSize()` recompute buffer across tenants (the prod
   * OOM vector).
   *
   * Correctness over availability: any tenant query failure throws. The bill
   * must never silently omit a tenant's bytes; the caller (the reporting
   * dispatcher) owns retry / skip / kill-switch.
   *
   * Returns raw bytes — the caller rounds to MiB.
   */
  async getBillableStorageBytesForOrgAt({
    organizationId,
    sealedHour,
  }: {
    organizationId: string;
    sealedHour: Date;
  }): Promise<number> {
    if (!this.resolveClickHouseClient || !this.resolveProjectIds) {
      // Billing requires both ClickHouse and the org→projects resolver. Unlike
      // the retention-UI reads (which degrade to 0 in OSS), a billing read must
      // never silently return 0 — that under-bills. The dispatcher only builds
      // this on the SaaS path where both are present, so a miss is a misconfig.
      throw new Error(
        "StorageMeterService: billable measurement requires a ClickHouse client and a project-ids resolver",
      );
    }

    // Second-precision UTC string bound as a DateTime('UTC') param — the column
    // expression is DateTime, and the explicit type keeps the boundary from
    // shifting with the ClickHouse session timezone.
    const cutoff = formatClickHouseDateTime(
      new Date(sealedHour.getTime() - BILLABLE_AFTER_DAYS * 24 * 60 * 60 * 1000),
    ).slice(0, 19);

    const projectIds = await this.resolveProjectIds(organizationId);

    let total = 0;
    for (const tenantId of projectIds) {
      const client = await this.resolveClickHouseClient(tenantId);
      const result = await client.query({
        query: BILLABLE_STORAGE_QUERY,
        query_params: { tenantId, cutoff },
        format: "JSONEachRow",
        clickhouse_settings: BILLABLE_METERING_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as Array<{ total: string }>;
      total += Number(rows[0]?.total ?? 0);
    }
    return total;
  }

  /**
   * Stored bytes for a tenant grouped by retention category. Each table is
   * queried independently so a single table's failure degrades that category
   * to zero rather than failing the whole breakdown.
   */
  async getStorageBreakdown({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<StorageBreakdown> {
    if (!this.resolveClickHouseClient) {
      return {
        totalBytes: 0,
        byCategory: { traces: 0, scenarios: 0, experiments: 0 },
      };
    }

    const client = await this.resolveClickHouseClient(tenantId);
    const byCategory: Record<RetentionCategory, number> = {
      traces: 0,
      scenarios: 0,
      experiments: 0,
    };

    for (const table of RETENTION_MANAGED_TABLES) {
      try {
        const result = await client.query({
          query: `SELECT sum(_size_bytes) AS total FROM ${table} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
          format: "JSONEachRow",
          clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
        });
        const rows = (await result.json()) as Array<{ total: string }>;
        const tableBytes = Number(rows[0]?.total ?? 0);
        const category = RETENTION_TABLE_CATEGORY_MAP[table]!;
        byCategory[category] += tableBytes;
      } catch (error) {
        logger.warn({ tenantId, table, error }, "Failed to query _size_bytes");
      }
    }

    const totalBytes = Object.values(byCategory).reduce((a, b) => a + b, 0);
    return { totalBytes, byCategory };
  }

  /**
   * Sums per-table `_size_bytes` totals for a tenant in a single query. Each
   * table is pre-aggregated inside a UNION ALL so only the 11 scalar subtotals
   * (not every row's `_size_bytes`) reach the outer sum.
   *
   * On parts where `_size_bytes` was never materialized this still recomputes
   * `byteSize(...)` over the heavy payload columns, which for the largest
   * tenants reads tens of GB and can exceed the per-query memory/time limit.
   * If the single aggregate fails for any reason, fall back to the per-table
   * {@link getStorageBreakdown}, whose per-table catch degrades only the
   * failing table to zero — so one heavy table can't fail the whole total.
   *
   * The durable fix is to stop the recompute entirely by backfilling the
   * column on existing parts (out of band, during a low-traffic window):
   *   ALTER TABLE <table> MATERIALIZE COLUMN _size_bytes;
   * after which every read hits the stored UInt32 and this path is cheap.
   */
  private async queryTotalBytes(tenantId: string): Promise<number> {
    if (!this.resolveClickHouseClient) return 0;

    const client = await this.resolveClickHouseClient(tenantId);
    // Aggregate per-table first, then sum the 11 scalars. The naive
    // UNION ALL on raw rows materializes every _size_bytes value into the
    // intermediate set before summing — explodes memory for tenants with
    // tens of millions of rows.
    const unions = RETENTION_MANAGED_TABLES.map(
      (table) =>
        `SELECT sum(_size_bytes) AS t FROM ${table} WHERE TenantId = {tenantId:String}`,
    ).join("\n  UNION ALL\n  ");

    try {
      const result = await client.query({
        query: `SELECT sum(t) AS total FROM (\n  ${unions}\n)`,
        query_params: { tenantId },
        format: "JSONEachRow",
        clickhouse_settings: METERING_CLICKHOUSE_SETTINGS,
      });
      const rows = (await result.json()) as Array<{ total: string }>;
      return Number(rows[0]?.total ?? 0);
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Total _size_bytes query failed; falling back to per-table breakdown",
      );
      const { totalBytes } = await this.getStorageBreakdown({ tenantId });
      return totalBytes;
    }
  }
}
