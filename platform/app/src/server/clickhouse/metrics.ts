import { createLogger } from "@langwatch/observability";
import { Counter, Gauge, Histogram, register } from "prom-client";
// Type-only: this module is imported BY the tenant client (for the query
// counters below), so a value import would close the cycle at runtime.
import type { TenantClickHouseClient } from "~/server/app-layer/clients/clickhouse/tenant-client";

const logger = createLogger("langwatch:clickhouse:metrics");

// ============================================================================
// Query Metrics
// ============================================================================

// Histogram for query duration
register.removeSingleMetric("clickhouse_query_duration_seconds");
export const clickhouseQueryDurationHistogram = new Histogram({
  name: "clickhouse_query_duration_seconds",
  help: "Duration of ClickHouse queries in seconds",
  labelNames: ["query_type", "table"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
});

export const observeClickHouseQueryDuration = (
  queryType: "SELECT" | "INSERT" | "OTHER",
  table: string,
  durationSeconds: number,
) =>
  clickhouseQueryDurationHistogram
    .labels(queryType, table)
    .observe(durationSeconds);

// Counter for query totals
register.removeSingleMetric("clickhouse_query_total");
const clickhouseQueryTotal = new Counter({
  name: "clickhouse_query_total",
  help: "Total number of ClickHouse queries",
  labelNames: ["query_type", "status"] as const,
});

export const incrementClickHouseQueryCount = (
  queryType: "SELECT" | "INSERT" | "OTHER",
  status: "success" | "error",
) => clickhouseQueryTotal.labels(queryType, status).inc();

// Counter for windowed reads: the partition-pruning-window-with-fallback read
// pattern (see app-layer/clients/clickhouse/windowed-read.ts). One increment
// per queryWindowed call, tagged with the path it took:
//   hit             - hinted window sufficed (cheap, no widening)
//   widened_hit     - hinted window empty; a bounded lookback re-scan found rows
//   widened_empty   - hinted window empty; bounded lookback re-scan also empty
//   unbounded_hit   - hinted window empty; unbounded re-scan found rows
//   unbounded_empty - hinted window empty; unbounded re-scan also empty
//   unwindowed      - no hint; ran the fallback window directly
//   error           - an attempt threw; the read failed rather than resolved
// Exists to size how often reads fall off the cheap path before a rate limit is
// chosen for the expensive ones.
export type WindowedReadOutcome =
  | "hit"
  | "widened_hit"
  | "widened_empty"
  | "unbounded_hit"
  | "unbounded_empty"
  | "unwindowed"
  | "error";

register.removeSingleMetric("clickhouse_windowed_read_total");
const clickhouseWindowedReadTotal = new Counter({
  name: "clickhouse_windowed_read_total",
  help: "Total number of ClickHouse windowed reads by table and outcome",
  labelNames: ["table", "outcome"] as const,
});

export const incrementWindowedReadCount = (
  table: string,
  outcome: WindowedReadOutcome,
) => clickhouseWindowedReadTotal.labels(table, outcome).inc();

// Counter for ClickHouse convention violations, counted on the way OUT of the
// app and before the query is sent (see app-layer/clients/clickhouse/
// convention-gate.ts). One increment per (table, rule) pair per query.
//
//   partition_predicate - reads a partitioned table with no filter on its
//                         partition column, so it cannot prune and walks the
//                         cold tier on S3
//   tenant_predicate    - reads a table with no comparison on any of its tenant
//                         columns
//
// This exists to be READ before anything is made to throw. Twenty-two of the
// thirty-three partitioned tables were invisible to the old detector, so the
// real violation rate is unknown; ranking tables by this counter is what
// decides which reads are worth fixing and when the gate can be promoted past
// counting. Same measure-before-limit discipline as
// clickhouse_windowed_read_total (ADR-068).
register.removeSingleMetric("clickhouse_convention_violation_total");
const clickhouseConventionViolationTotal = new Counter({
  name: "clickhouse_convention_violation_total",
  help: "ClickHouse reads that break a query convention, by table and rule",
  labelNames: ["table", "rule"] as const,
});

export const incrementConventionViolation = (table: string, rule: string) =>
  clickhouseConventionViolationTotal.labels(table, rule).inc();

// ============================================================================
// Storage Metrics
// ============================================================================

// Gauge for table row counts
register.removeSingleMetric("clickhouse_table_rows");
const clickhouseTableRows = new Gauge({
  name: "clickhouse_table_rows",
  help: "Number of rows in ClickHouse tables",
  labelNames: ["table"] as const,
});

export const setClickHouseTableRows = (table: string, rows: number) =>
  clickhouseTableRows.labels(table).set(rows);

// Gauge for table sizes in bytes
register.removeSingleMetric("clickhouse_table_bytes");
const clickhouseTableBytes = new Gauge({
  name: "clickhouse_table_bytes",
  help: "Size of ClickHouse tables in bytes",
  labelNames: ["table"] as const,
});

export const setClickHouseTableBytes = (table: string, bytes: number) =>
  clickhouseTableBytes.labels(table).set(bytes);

// Gauge for table part counts
register.removeSingleMetric("clickhouse_table_parts");
const clickhouseTableParts = new Gauge({
  name: "clickhouse_table_parts",
  help: "Number of parts in ClickHouse tables",
  labelNames: ["table"] as const,
});

export const setClickHouseTableParts = (table: string, parts: number) =>
  clickhouseTableParts.labels(table).set(parts);

// ============================================================================
// Connection Metrics
// ============================================================================

// Gauge for active connections
register.removeSingleMetric("clickhouse_connections_active");
const clickhouseConnectionsActive = new Gauge({
  name: "clickhouse_connections_active",
  help: "Number of active ClickHouse connections",
});

export const setClickHouseActiveConnections = (count: number) =>
  clickhouseConnectionsActive.set(count);

// ============================================================================
// Query Wrapper with Metrics
// ============================================================================

/**
 * Wraps a ClickHouse query execution with metrics collection.
 * Automatically records query duration and success/failure counts.
 */
export async function executeWithMetrics<T>(
  queryFn: () => Promise<T>,
  queryType: "SELECT" | "INSERT" | "OTHER",
  table: string,
): Promise<T> {
  const start = performance.now();

  try {
    const result = await queryFn();
    const durationSeconds = (performance.now() - start) / 1000;

    observeClickHouseQueryDuration(queryType, table, durationSeconds);
    incrementClickHouseQueryCount(queryType, "success");

    return result;
  } catch (error) {
    const durationSeconds = (performance.now() - start) / 1000;

    observeClickHouseQueryDuration(queryType, table, durationSeconds);
    incrementClickHouseQueryCount(queryType, "error");

    throw error;
  }
}

// ============================================================================
// Backup Status Metrics
// ============================================================================

// Lazy-registered: gauges only materialize after the first successful update,
// so non-worker pods (which never call collectStorageStats) don't pollute
// /metrics with default-zero series. Combined with `noDataState: Alerting`,
// a missing gauge becomes a real signal that no worker is reporting.
let clickhouseBackupLastSuccessTimestamp: Gauge<string> | null = null;
let clickhouseBackupLastSizeBytes: Gauge<string> | null = null;
let clickhouseBackupStatusTotal: Gauge<"status"> | null = null;

export const setClickHouseBackupLastSuccessTimestamp = (ts: number) => {
  if (!clickhouseBackupLastSuccessTimestamp) {
    register.removeSingleMetric(
      "clickhouse_backup_last_success_timestamp_seconds",
    );
    clickhouseBackupLastSuccessTimestamp = new Gauge({
      name: "clickhouse_backup_last_success_timestamp_seconds",
      help: "Timestamp of the last successful ClickHouse backup (Unix seconds)",
    });
  }
  clickhouseBackupLastSuccessTimestamp.set(ts);
};

export const setClickHouseBackupLastSizeBytes = (bytes: number) => {
  if (!clickhouseBackupLastSizeBytes) {
    register.removeSingleMetric("clickhouse_backup_last_size_bytes");
    clickhouseBackupLastSizeBytes = new Gauge({
      name: "clickhouse_backup_last_size_bytes",
      help: "Size of the last successful ClickHouse backup in bytes",
    });
  }
  clickhouseBackupLastSizeBytes.set(bytes);
};

const ensureBackupStatusTotal = (): Gauge<"status"> => {
  if (!clickhouseBackupStatusTotal) {
    register.removeSingleMetric("clickhouse_backup_status_total");
    clickhouseBackupStatusTotal = new Gauge({
      name: "clickhouse_backup_status_total",
      help: "Count of ClickHouse backups by status",
      labelNames: ["status"] as const,
    });
  }
  return clickhouseBackupStatusTotal;
};

export const setClickHouseBackupStatusCount = (status: string, count: number) =>
  ensureBackupStatusTotal().labels(status).set(count);

// Edge-triggered: collectStorageStats runs every 15s, so we'd otherwise
// produce 5,760 identical warns/day if system.backups is unavailable.
let backupStatsCollectionFailing = false;

// ============================================================================
// Disk Storage Metrics
// ============================================================================

register.removeSingleMetric("clickhouse_disk_total_bytes");
const clickhouseDiskTotalBytes = new Gauge({
  name: "clickhouse_disk_total_bytes",
  help: "Total disk space in bytes by disk name",
  labelNames: ["disk_name"] as const,
});

export const setClickHouseDiskTotalBytes = (diskName: string, bytes: number) =>
  clickhouseDiskTotalBytes.labels(diskName).set(bytes);

register.removeSingleMetric("clickhouse_disk_used_bytes");
const clickhouseDiskUsedBytes = new Gauge({
  name: "clickhouse_disk_used_bytes",
  help: "Used disk space in bytes by disk name",
  labelNames: ["disk_name"] as const,
});

export const setClickHouseDiskUsedBytes = (diskName: string, bytes: number) =>
  clickhouseDiskUsedBytes.labels(diskName).set(bytes);

register.removeSingleMetric("clickhouse_disk_free_bytes");
const clickhouseDiskFreeBytes = new Gauge({
  name: "clickhouse_disk_free_bytes",
  help: "Free disk space in bytes by disk name",
  labelNames: ["disk_name"] as const,
});

export const setClickHouseDiskFreeBytes = (diskName: string, bytes: number) =>
  clickhouseDiskFreeBytes.labels(diskName).set(bytes);

// ============================================================================
// Storage Stats Collector
// ============================================================================

// Tables to monitor
const MONITORED_TABLES = [
  "event_log",
  "stored_spans",
  "trace_summaries",
  "llm_spans_tokens_usage",
  "evaluations",
  "events",
  // ADR-096: offloaded evaluator inputs (and other externalized content) live
  // here; monitoring its on-disk footprint surfaces the durable-object cost.
  "stored_objects",
];

/**
 * Collects ClickHouse backup status from system.backup_log into the backup gauges.
 * Extracted so collectStorageStats can gate it behind the explicit opt-in (see the
 * call site).
 *
 * We deliberately query system.backup_log instead of system.backups: system.backups
 * is an in-memory table that gets wiped on CH restart, which happens on every app
 * deploy (the CH image tag is bumped by the build pipeline). After a restart the
 * in-memory table is empty until the next scheduled backup runs, so a freshly-rolled
 * worker pod sees zero rows and never emits the gauge, tripping the "Backup Reporting
 * Absent" alert despite backups being healthy. system.backup_log is a persistent
 * system table that retains entries across restarts.
 */
async function collectBackupStats(
  client: TenantClickHouseClient,
): Promise<void> {
  try {
    // `cnt` and `last_success_size` are UInt64 on the wire. The client asks the
    // server to quote 64-bit integers and the tenant wrapper converts them back
    // to `number` from the result header, so they arrive here exactly as the
    // driver path delivered them — hence no parseInt.
    interface BackupStats {
      status: string;
      cnt: number;
      last_success_time: string;
      last_success_size: number;
    }

    const backupRows = await client.query<BackupStats>({
      sql: `
        SELECT
          status,
          count() as cnt,
          maxIf(end_time, status = 'BACKUP_CREATED') as last_success_time,
          argMaxIf(total_size, end_time, status = 'BACKUP_CREATED') as last_success_size
        FROM system.backup_log
        GROUP BY status
      `,
    });

    ensureBackupStatusTotal().reset();
    for (const row of backupRows) {
      setClickHouseBackupStatusCount(row.status, Number(row.cnt));

      if (row.status === "BACKUP_CREATED" && row.last_success_time) {
        const ts = new Date(row.last_success_time).getTime() / 1000;
        if (!isNaN(ts) && ts > 0) {
          setClickHouseBackupLastSuccessTimestamp(ts);
        }
        const size = Number(row.last_success_size);
        if (!isNaN(size)) {
          setClickHouseBackupLastSizeBytes(size);
        }
      }
    }

    if (backupStatsCollectionFailing) {
      logger.info(
        "ClickHouse backup stats collection recovered from previous failure",
      );
      backupStatsCollectionFailing = false;
    }
  } catch (backupError) {
    // Even where backups ARE configured the table can be transiently unavailable
    // (a CH restart mid-tick), so a failure is handled, not fatal. Only
    // deployments that opted in reach here, and they care — surface it
    // edge-triggered, once, until it recovers.
    if (!backupStatsCollectionFailing) {
      logger.warn(
        { error: backupError },
        "Failed to collect ClickHouse backup stats from system.backup_log (further failures suppressed until recovery)",
      );
      backupStatsCollectionFailing = true;
    } else {
      logger.debug(
        { error: backupError },
        "Failed to collect ClickHouse backup stats from system.backup_log",
      );
    }
  }
}

/**
 * Collects storage statistics for monitored tables.
 * Should be called periodically (e.g., every 15 seconds).
 */
export async function collectStorageStats(
  client: TenantClickHouseClient,
): Promise<void> {
  try {
    // The three aggregates are UInt64; see collectBackupStats for why they
    // arrive as numbers rather than quoted strings.
    interface TableStats {
      table: string;
      total_rows: number;
      total_bytes: number;
      parts_count: number;
    }

    const rows = await client.query<TableStats>({
      sql: `
        SELECT
          table,
          sum(rows) as total_rows,
          sum(bytes_on_disk) as total_bytes,
          count() as parts_count
        FROM system.parts
        WHERE database = currentDatabase()
          AND active = 1
          AND table IN ({tables:Array(String)})
        GROUP BY table
      `,
      params: { tables: MONITORED_TABLES },
    });

    // Reset before repopulating (mirrors the per-disk gauges below). Without
    // this, a table that TTL-drops to zero active parts — or is simply absent
    // from one tick's `system.parts` result — keeps its last non-zero value
    // forever, so `clickhouse_table_bytes`/`_rows`/`_parts` report phantom size
    // long after the data is gone (these feed the DB-size and trace_summaries
    // alerts). Placed after the query resolves so a query error keeps the last
    // known values rather than zeroing them.
    clickhouseTableRows.reset();
    clickhouseTableBytes.reset();
    clickhouseTableParts.reset();
    for (const row of rows) {
      setClickHouseTableRows(row.table, Number(row.total_rows));
      setClickHouseTableBytes(row.table, Number(row.total_bytes));
      setClickHouseTableParts(row.table, Number(row.parts_count));
    }

    // Backup status only exists where backups are configured (the production
    // cluster, via clickhouse-serverless's backup cronjobs) — everywhere else this
    // query just fails on every 15s tick for nothing, and NODE_ENV can't tell
    // "has backups" from "staging/self-hosted production build". So the deployment
    // that has backups opts in explicitly (set on the worker alongside the backup
    // cronjobs). Gating here (not at one call site) covers both the app under
    // haven's in-process workers and the standalone worker.
    // See specs/ops/clickhouse-backup-metrics.feature.
    if (process.env.CLICKHOUSE_BACKUP_METRICS_ENABLED === "true") {
      await collectBackupStats(client);
    }

    // Collect per-disk storage metrics
    try {
      interface DiskStats {
        name: string;
        total_space: number;
        free_space: number;
        used_space: number;
      }

      const diskRows = await client.query<DiskStats>({
        sql: `
          SELECT
            name,
            total_space,
            free_space,
            (total_space - free_space) as used_space
          FROM system.disks
        `,
      });

      clickhouseDiskTotalBytes.reset();
      clickhouseDiskUsedBytes.reset();
      clickhouseDiskFreeBytes.reset();
      for (const row of diskRows) {
        setClickHouseDiskTotalBytes(row.name, Number(row.total_space));
        setClickHouseDiskUsedBytes(row.name, Number(row.used_space));
        setClickHouseDiskFreeBytes(row.name, Number(row.free_space));
      }
    } catch (diskError) {
      logger.debug(
        { error: diskError },
        "Failed to collect ClickHouse disk stats",
      );
    }
  } catch (error) {
    logger.error({ error }, "Failed to collect ClickHouse storage stats");
  }
}

let storageStatsInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Starts periodic collection of ClickHouse storage statistics.
 * Collects stats every 15 seconds by default.
 */
export function startStorageStatsCollection(
  client: TenantClickHouseClient,
  intervalMs = 15000,
): void {
  if (storageStatsInterval) {
    return; // Already running
  }

  // Collect immediately
  void collectStorageStats(client);

  // Then collect periodically
  storageStatsInterval = setInterval(() => {
    void collectStorageStats(client);
  }, intervalMs);
}

/**
 * Stops the periodic storage stats collection.
 */
export function stopStorageStatsCollection(): void {
  if (storageStatsInterval) {
    clearInterval(storageStatsInterval);
    storageStatsInterval = null;
  }
}
