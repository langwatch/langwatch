import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { Counter, Gauge, Histogram, register } from "prom-client";
import { _getSharedClickHouseClient } from "./client";

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
) => clickhouseQueryDurationHistogram.labels(queryType, table).observe(durationSeconds);

// Counter for query totals
register.removeSingleMetric("clickhouse_query_total");
const clickhouseQueryTotal = new Counter({
  name: "clickhouse_query_total",
  help: "Total number of ClickHouse queries",
  labelNames: ["query_type", "status"] as const,
});

export const incrementClickHouseQueryCount = (
  queryType: "SELECT" | "INSERT" | "OTHER",
  // "inband_error": the transport succeeded (already counted as "success")
  // but the streamed body carried a ClickHouse exception row. A dedicated
  // outcome keeps success/error ratios honest — the same query is never
  // counted under both terminal outcomes.
  status: "success" | "error" | "inband_error",
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
  /**
   * The hinted window came back empty and the caller forbade widening
   * (`fallback: "none"`), so there is no widen outcome to record instead. Split
   * out of `hit` because a read that resolves queued work retries on empty:
   * counting it as a hit made a permanently-failing lookup read as a healthy
   * one, which is how 22 blocked claim-check groups stayed invisible on this
   * metric through 2026-08-05.
   */
  | "windowed_empty"
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

export const incrementWindowedReadCount = (table: string, outcome: WindowedReadOutcome) =>
  clickhouseWindowedReadTotal.labels(table, outcome).inc();

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
// Statement Concurrency Metrics
// ============================================================================

// How many statements a process is running and how many are waiting for a slot
// (see @langwatch/clickhouse-client managed client policy). These are the numbers nobody
// could see during the 2026-07-31 overload: the server's own counters show
// what it admitted, never what a client was holding back. Sized from the
// limiter itself at scrape time rather than tracked by hand, so the gauges
// cannot drift from the limiter they describe.
type LimiterStatsProbe = () => { inFlight: number; queued: number };

const limiterProbes = new Map<string, LimiterStatsProbe>();

/**
 * Registers a limiter under an instance label. Re-registering the same label
 * replaces the probe, which is what a client rebuild (tests, a private instance
 * re-resolved) should do - two probes for one label would double-count.
 */
export const registerClickHouseLimiter = (instance: string, probe: LimiterStatsProbe): void => {
  limiterProbes.set(instance, probe);
};

/** Drops a limiter's probe, e.g. when its client is closed. */
export const unregisterClickHouseLimiter = (instance: string): void => {
  limiterProbes.delete(instance);
};

register.removeSingleMetric("clickhouse_statements_in_flight");
const clickhouseStatementsInFlight = new Gauge({
  name: "clickhouse_statements_in_flight",
  help: "ClickHouse statements this process currently has in flight",
  labelNames: ["instance"] as const,
  collect() {
    // Reset first. `labels().set()` only ever writes, so a client that has
    // been closed would keep publishing its final value for the life of the
    // process - a gauge describing a limiter that no longer fronts anything.
    this.reset();
    for (const [instance, probe] of limiterProbes) {
      this.labels(instance).set(probe().inFlight);
    }
  },
});

register.removeSingleMetric("clickhouse_statements_queued");
const clickhouseStatementsQueued = new Gauge({
  name: "clickhouse_statements_queued",
  help: "ClickHouse statements waiting for a concurrency slot in this process",
  labelNames: ["instance"] as const,
  collect() {
    this.reset();
    for (const [instance, probe] of limiterProbes) {
      this.labels(instance).set(probe().queued);
    }
  },
});

// The alerting signal. Anything above zero means a process refused its own
// work rather than pile it onto an overloaded server - useful, but not
// something to discover from a customer.
register.removeSingleMetric("clickhouse_statements_shed_total");
const clickhouseStatementsShed = new Counter({
  name: "clickhouse_statements_shed_total",
  help: "ClickHouse statements refused because the concurrency wait queue was full",
  labelNames: ["instance", "operation"] as const,
});

export const incrementClickHouseStatementsShed = (instance: string, operation: string) =>
  clickhouseStatementsShed.labels(instance, operation).inc();

// Time spent waiting for a slot, which is the latency the pool used to hide.
// Buckets start below a millisecond because the uncontended case must be
// visibly free, and end at a minute because a wait that long is the incident.
register.removeSingleMetric("clickhouse_statement_wait_seconds");
const clickhouseStatementWait = new Histogram({
  name: "clickhouse_statement_wait_seconds",
  help: "Time a ClickHouse statement waited for a concurrency slot",
  labelNames: ["instance", "operation"] as const,
  buckets: [0.0005, 0.005, 0.025, 0.1, 0.5, 1, 5, 15, 60],
});

export const observeClickHouseStatementWait = (
  instance: string,
  operation: string,
  waitSeconds: number,
) => clickhouseStatementWait.labels(instance, operation).observe(waitSeconds);

// Exported for the boot-time report and for tests that assert the gauges exist
// without scraping the whole registry.
export const clickHouseConcurrencyMetrics = {
  inFlight: clickhouseStatementsInFlight,
  queued: clickhouseStatementsQueued,
  shed: clickhouseStatementsShed,
  wait: clickhouseStatementWait,
};

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
    register.removeSingleMetric("clickhouse_backup_last_success_timestamp_seconds");
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
  // ADR-040: offloaded evaluator inputs (and other externalized content) live
  // here; monitoring its on-disk footprint surfaces the durable-object cost.
  "stored_objects",
];

/** Values of CLICKHOUSE_BACKUP_METRICS_ENABLED that turn backup collection off. */
const BACKUP_METRICS_OFF_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * Whether this deployment should collect backup-status gauges from
 * system.backup_log.
 *
 * Collection is ON unless explicitly disabled. The gauges predate this flag and
 * production alerts (clickhouse_backup_last_success_timestamp_seconds,
 * clickhouse_backup_status_total, and the "Backup Reporting Absent" rule built on
 * them) already depend on them, while the deployments that emit them do not set
 * the variable. Defaulting to off silently disarms live backup monitoring on the
 * next deploy, so an unset, or unparseable, value keeps the existing behaviour and
 * only a deliberate opt-OUT stops collection.
 *
 * Opting out is for environments where backups genuinely do not exist (local dev
 * under haven, CI, self-hosted installs without backups), where the table is
 * missing and the query would fail on every 15s tick for nothing.
 *
 * See specs/ops/clickhouse-backup-metrics.feature.
 */
export function shouldCollectBackupMetrics(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CLICKHOUSE_BACKUP_METRICS_ENABLED;
  if (typeof raw !== "string") return true;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return true;
  return !BACKUP_METRICS_OFF_VALUES.has(normalized);
}

/**
 * Collects ClickHouse backup status from system.backup_log into the backup gauges.
 * Extracted so collectStorageStats can gate it behind the opt-out (see the call
 * site).
 *
 * We deliberately query system.backup_log instead of system.backups: system.backups
 * is an in-memory table that gets wiped on CH restart, which happens on every app
 * deploy (the CH image tag is bumped by the build pipeline). After a restart the
 * in-memory table is empty until the next scheduled backup runs, so a freshly-rolled
 * worker pod sees zero rows and never emits the gauge, tripping the "Backup Reporting
 * Absent" alert despite backups being healthy. system.backup_log is a persistent
 * system table that retains entries across restarts.
 */
async function collectBackupStats(client: ClickHouseClient): Promise<void> {
  try {
    interface BackupStats {
      status: string;
      cnt: string;
      last_success_time: string;
      last_success_size: string;
    }

    const backupResult = await client.query({
      query: `
        SELECT
          status,
          count() as cnt,
          maxIf(end_time, status = 'BACKUP_CREATED') as last_success_time,
          argMaxIf(total_size, end_time, status = 'BACKUP_CREATED') as last_success_size
        FROM system.backup_log
        GROUP BY status
      `,
    });

    const backupRows = await backupResult.json<BackupStats>();

    ensureBackupStatusTotal().reset();
    for (const row of backupRows.data) {
      setClickHouseBackupStatusCount(row.status, parseInt(row.cnt, 10));

      if (row.status === "BACKUP_CREATED" && row.last_success_time) {
        const ts = new Date(row.last_success_time).getTime() / 1000;
        if (!isNaN(ts) && ts > 0) {
          setClickHouseBackupLastSuccessTimestamp(ts);
        }
        const size = parseInt(row.last_success_size, 10);
        if (!isNaN(size)) {
          setClickHouseBackupLastSizeBytes(size);
        }
      }
    }

    if (backupStatsCollectionFailing) {
      logger.info("ClickHouse backup stats collection recovered from previous failure");
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
export async function collectStorageStats(client: ClickHouseClient): Promise<void> {
  try {
    interface TableStats {
      table: string;
      total_rows: string;
      total_bytes: string;
      parts_count: string;
    }

    const result = await client.query({
      query: `
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
      query_params: { tables: MONITORED_TABLES },
    });

    const rows = await result.json<TableStats>();

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
    for (const row of rows.data) {
      setClickHouseTableRows(row.table, parseInt(row.total_rows, 10));
      setClickHouseTableBytes(row.table, parseInt(row.total_bytes, 10));
      setClickHouseTableParts(row.table, parseInt(row.parts_count, 10));
    }

    // Backup status only exists where backups are configured (the production
    // cluster, via clickhouse-serverless's backup cronjobs) — everywhere else this
    // query just fails on every 15s tick for nothing, and NODE_ENV can't tell
    // "has backups" from "staging/self-hosted production build". So the
    // deployments WITHOUT backups opt out explicitly; unset stays on, because
    // production already emits these gauges and alerts on them without setting
    // anything. Gating here (not at one call site) covers both the app under
    // haven's in-process workers and the standalone worker.
    // See specs/ops/clickhouse-backup-metrics.feature.
    if (shouldCollectBackupMetrics()) {
      await collectBackupStats(client);
    }

    // Collect per-disk storage metrics
    try {
      interface DiskStats {
        name: string;
        total_space: string;
        free_space: string;
        used_space: string;
      }

      const diskResult = await client.query({
        query: `
          SELECT
            name,
            total_space,
            free_space,
            (total_space - free_space) as used_space
          FROM system.disks
        `,
      });

      const diskRows = await diskResult.json<DiskStats>();

      clickhouseDiskTotalBytes.reset();
      clickhouseDiskUsedBytes.reset();
      clickhouseDiskFreeBytes.reset();
      for (const row of diskRows.data) {
        setClickHouseDiskTotalBytes(row.name, parseInt(row.total_space, 10));
        setClickHouseDiskUsedBytes(row.name, parseInt(row.used_space, 10));
        setClickHouseDiskFreeBytes(row.name, parseInt(row.free_space, 10));
      }
    } catch (diskError) {
      logger.debug({ error: diskError }, "Failed to collect ClickHouse disk stats");
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
export function startStorageStatsCollection(client: ClickHouseClient, intervalMs = 15000): void {
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

/**
 * Starts storage-stats collection off the shared (non-tenant) ClickHouse
 * client, resolving it here instead of at the worker boot call site — this
 * module is the one place allowed to reach for a client directly. Returns
 * `false` without starting anything when ClickHouse isn't configured.
 */
export function startStorageStatsCollectionFromSharedClient(intervalMs?: number): boolean {
  const client = _getSharedClickHouseClient();
  if (!client) return false;
  startStorageStatsCollection(client, intervalMs);
  return true;
}
