import { Counter, Gauge, Histogram, register } from "prom-client";
import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";

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

register.removeSingleMetric("clickhouse_backup_last_success_timestamp_seconds");
const clickhouseBackupLastSuccessTimestamp = new Gauge({
  name: "clickhouse_backup_last_success_timestamp_seconds",
  help: "Timestamp of the last successful ClickHouse backup (Unix seconds)",
});

export const setClickHouseBackupLastSuccessTimestamp = (ts: number) =>
  clickhouseBackupLastSuccessTimestamp.set(ts);

register.removeSingleMetric("clickhouse_backup_last_size_bytes");
const clickhouseBackupLastSizeBytes = new Gauge({
  name: "clickhouse_backup_last_size_bytes",
  help: "Size of the last successful ClickHouse backup in bytes",
});

export const setClickHouseBackupLastSizeBytes = (bytes: number) =>
  clickhouseBackupLastSizeBytes.set(bytes);

register.removeSingleMetric("clickhouse_backup_status_total");
const clickhouseBackupStatusTotal = new Gauge({
  name: "clickhouse_backup_status_total",
  help: "Count of ClickHouse backups by status",
  labelNames: ["status"] as const,
});

export const setClickHouseBackupStatusCount = (
  status: string,
  count: number,
) => clickhouseBackupStatusTotal.labels(status).set(count);

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
];

/**
 * Collects storage statistics for monitored tables.
 * Should be called periodically (e.g., every 15 seconds).
 */
export async function collectStorageStats(
  client: ClickHouseClient,
): Promise<void> {
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

    for (const row of rows.data) {
      setClickHouseTableRows(row.table, parseInt(row.total_rows, 10));
      setClickHouseTableBytes(row.table, parseInt(row.total_bytes, 10));
      setClickHouseTableParts(row.table, parseInt(row.parts_count, 10));
    }

    // Collect backup status metrics
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
            maxIf(total_size, status = 'BACKUP_CREATED') as last_success_size
          FROM system.backups
          GROUP BY status
        `,
      });

      const backupRows = await backupResult.json<BackupStats>();

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
    } catch (backupError) {
      // system.backups may not exist on all ClickHouse versions
      logger.debug(
        { error: backupError },
        "Failed to collect ClickHouse backup stats (system.backups may not exist)",
      );
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

      for (const row of diskRows.data) {
        setClickHouseDiskTotalBytes(row.name, parseInt(row.total_space, 10));
        setClickHouseDiskUsedBytes(row.name, parseInt(row.used_space, 10));
        setClickHouseDiskFreeBytes(row.name, parseInt(row.free_space, 10));
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
  client: ClickHouseClient,
  intervalMs: number = 15000,
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
