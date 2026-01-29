import { Counter, Gauge, Histogram, register } from "prom-client";
import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger";

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
  client: ClickHouseClient,
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
