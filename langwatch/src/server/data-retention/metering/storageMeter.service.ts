import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { TtlCache } from "~/server/utils/ttlCache";
import { createLogger } from "~/utils/logger/server";
import {
  RETENTION_MANAGED_TABLES,
  RETENTION_TABLE_CATEGORY_MAP,
  type RetentionCategory,
} from "../retentionPolicy.schema";

const logger = createLogger("langwatch:data-retention:metering");

// Stale-while-revalidate windows for the per-tenant byte total.
//
// A read within FRESH_MS returns the cached value untouched. Past it (but
// before the entry's hard TTL lapses in Redis) the read still returns the
// cached value *immediately* and kicks a background recompute — so the only
// request that ever blocks on the heavy `_size_bytes` read is the very first
// for a tenant (or one after a long idle gap). HARD_TTL_MS is the underlying
// Redis TTL: long enough that an active org keeps serving instantly across the
// 5-minute freshness boundary, short enough that a cold entry eventually drops.
const STORAGE_FRESH_MS = 5 * 60 * 1000;
const STORAGE_HARD_TTL_MS = 30 * 60 * 1000;

// Background refreshes are single-flighted through a short-lived Redis lock
// (SET NX): when many pods/tabs see the same entry go stale at once, only the
// one that claims the lock recomputes — the rest skip. The lock is left to
// expire rather than released, throttling a tenant's refreshes to at most one
// per window so a persistently slow tenant can't be re-read every few seconds.
const REFRESH_LOCK_TTL_MS = 60 * 1000;

/** Cached per-tenant byte total plus the wall-clock it was computed at, so the
 *  read path can tell fresh from stale without a second timestamp store. */
interface CachedBytes {
  bytes: number;
  computedAt: number;
}

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

interface StorageBreakdown {
  totalBytes: number;
  byCategory: Record<RetentionCategory, number>;
}

export class StorageMeterService {
  private readonly cache: TtlCache<CachedBytes>;
  private readonly refreshLock: TtlCache<number>;
  private readonly now: () => number;

  constructor(
    private readonly resolveClickHouseClient: ClickHouseClientResolver | null,
    options?: { now?: () => number },
  ) {
    this.cache = new TtlCache(STORAGE_HARD_TTL_MS, "storage-meter:v2:");
    this.refreshLock = new TtlCache(
      REFRESH_LOCK_TTL_MS,
      "storage-meter:refresh:",
    );
    // Injectable clock so the stale-while-revalidate timing is deterministic in
    // tests; production uses the wall clock.
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * Total stored bytes for a tenant across all retention-managed tables, served
   * stale-while-revalidate: a cached value is returned immediately, and if it
   * has aged past {@link STORAGE_FRESH_MS} a single-flighted background refresh
   * is kicked (see {@link refreshInBackground}). Only the first read for a
   * tenant — when nothing is cached — blocks on the heavy {@link queryTotalBytes}.
   */
  async getTotalStorageBytes({
    tenantId,
  }: {
    tenantId: string;
  }): Promise<number> {
    const entry = await this.cache.get(tenantId);
    if (entry !== undefined) {
      if (this.now() - entry.computedAt >= STORAGE_FRESH_MS) {
        void this.refreshInBackground(tenantId);
      }
      return entry.bytes;
    }

    // Cold (or long-idle) tenant: compute synchronously so the caller gets a
    // real number. A failing read caches a degraded 0 marked already-stale, so
    // the scope total doesn't re-trigger this heavy failing query every request
    // yet self-heals via a background refresh on the next read.
    try {
      return await this.computeAndStore(tenantId);
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Cold storage read failed; caching degraded 0 (self-heals on next read)",
      );
      await this.cache.set(tenantId, {
        bytes: 0,
        computedAt: this.now() - STORAGE_FRESH_MS,
      });
      return 0;
    }
  }

  /** Recompute a tenant's total and write it to the cache stamped now. Shared by
   *  the cold path and the background refresh. */
  private async computeAndStore(tenantId: string): Promise<number> {
    const bytes = await this.queryTotalBytes(tenantId);
    await this.cache.set(tenantId, { bytes, computedAt: this.now() });
    return bytes;
  }

  /** Single-flighted background recompute for a stale entry. The lock is left to
   *  expire (not released) so a tenant is refreshed at most once per window, and
   *  a failed refresh keeps the last good value rather than poisoning the cache. */
  private async refreshInBackground(tenantId: string): Promise<void> {
    const won = await this.refreshLock.claim(tenantId, 1);
    if (!won) return;
    try {
      await this.computeAndStore(tenantId);
    } catch (error) {
      logger.warn(
        { tenantId, error },
        "Background storage refresh failed; keeping last good value",
      );
    }
  }

  /**
   * Total stored bytes summed across many tenants (e.g. every project in an
   * organization or team scope). Intentionally reuses {@link getTotalStorageBytes}
   * per tenant rather than issuing one `TenantId IN (...)` sum: each per-tenant
   * read keeps the hardened settings (capped threads + execution time + the
   * per-table fallback) AND its own stale-while-revalidate cache, so an org-wide
   * total is mostly instant cache hits, a stale entry refreshes in the
   * background instead of blocking the page, and a single heavy tenant can't
   * blow the memory ceiling for the whole scope. A wide `IN` sum would re-expose
   * the OOM hazard that `_size_bytes`'s lazy recompute caused in production and
   * bypass the cache.
   *
   * Reads run with bounded concurrency so a cold cache over a large org issues
   * a steady trickle rather than a thundering herd of recompute reads. A tenant
   * whose read fails degrades to 0 (its own fallback already tried), so one
   * project can't fail the scope total — acceptable because this powers a
   * display, not billing.
   */
  async getTotalStorageBytesForTenants(tenantIds: string[]): Promise<number> {
    const unique = Array.from(new Set(tenantIds));
    if (unique.length === 0) return 0;

    const CONCURRENCY = 8;
    let total = 0;
    for (let i = 0; i < unique.length; i += CONCURRENCY) {
      const batch = unique.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map((tenantId) =>
          this.getTotalStorageBytes({ tenantId }).catch((error) => {
            logger.warn(
              { tenantId, error },
              "Per-tenant storage read failed in scope aggregation; counting 0",
            );
            return 0;
          }),
        ),
      );
      total += results.reduce((a, b) => a + b, 0);
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
