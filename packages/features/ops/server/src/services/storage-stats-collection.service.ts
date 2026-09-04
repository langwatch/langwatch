/**
 * What the install's ClickHouse is actually holding.
 *
 * The rows, bytes and part counts behind every size alert, the per-disk
 * headroom behind the capacity ones, and the backup log behind "Backup
 * Reporting Absent". Nothing else in the fleet reads them: a deployment
 * running no collector has no producer for those gauges at all, and an alert
 * with no series looks exactly like an alert that is not firing.
 *
 * EVERY CONFIGURED ENDPOINT, not just the shared one. An install with private
 * organization routes keeps a tenant's data on its own ClickHouse, and a
 * collector that read only the shared endpoint would report that install as
 * far smaller than it is. Each series therefore carries the endpoint it came
 * from.
 *
 * @see specs/ops/clickhouse-storage-metrics.feature
 */

import { createLogger } from "@langwatch/observability";

import type { StorageStatsMetricsPort } from "../ports/storage-stats-metrics.port";

const logger = createLogger("langwatch:ops:storage-stats");

/** The tables whose footprint the size and retention alerts are built on. */
const MONITORED_TABLES = [
  "event_log",
  "stored_spans",
  "trace_summaries",
  "llm_spans_tokens_usage",
  "evaluations",
  "events",
  // ADR-040: offloaded evaluator inputs and other externalised content live
  // here, so its on-disk footprint is the durable-object cost.
  "stored_objects",
] as const;

const DEFAULT_INTERVAL_MS = 15_000;

/** The narrow read a system-table query needs, as this service asks it. */
export interface StorageStatsClickHouseClient {
  query(input: {
    query: string;
    query_params?: Record<string, readonly string[]>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
  }): Promise<{ json<Row>(): Promise<{ data: Row[] }> }>;
}

export interface StorageStatsInstance {
  target: string;
  client: StorageStatsClickHouseClient;
}

export interface StorageStatsCollectionHandle {
  stop(): void;
}

export interface StorageStatsCollectionOptions {
  resolveInstances: () => Promise<readonly StorageStatsInstance[]>;
  metrics: StorageStatsMetricsPort;
  /**
   * Whether the backup log is read at all.
   *
   * On unless a deployment opts out: the gauges predate the switch and the
   * production alerts already depend on them, while the deployments that emit
   * them set nothing. Defaulting to off would silently disarm live backup
   * monitoring on the next deploy.
   */
  collectBackups: boolean;
  intervalMs?: number;
}

export class StorageStatsCollectionService {
  static create(options: StorageStatsCollectionOptions): StorageStatsCollectionService {
    return new StorageStatsCollectionService(options);
  }

  private timer: ReturnType<typeof setInterval> | undefined;
  private backupsFailing = false;
  private backupLogAbsent = false;

  private constructor(private readonly options: StorageStatsCollectionOptions) {}

  /** One pass over every configured endpoint. Exported for a test to drive. */
  async collect(): Promise<void> {
    let instances: readonly StorageStatsInstance[];
    try {
      instances = await this.options.resolveInstances();
    } catch (error) {
      logger.error({ error }, "could not enumerate ClickHouse endpoints for storage stats");
      return;
    }

    // Per endpoint, never all-or-nothing: one unreachable private ClickHouse
    // must not take the shared endpoint's numbers off the dashboards with it.
    for (const instance of instances) {
      try {
        await this.collectInstance(instance);
      } catch (error) {
        logger.error(
          { error, instance: instance.target },
          "failed to collect ClickHouse storage stats",
        );
      }
    }
  }

  start(): StorageStatsCollectionHandle {
    if (!this.timer) {
      void this.collect();
      this.timer = setInterval(
        () => void this.collect(),
        this.options.intervalMs ?? DEFAULT_INTERVAL_MS,
      );
    }
    return {
      stop: () => {
        if (this.timer) clearInterval(this.timer);
        this.timer = undefined;
      },
    };
  }

  private async collectInstance(instance: StorageStatsInstance): Promise<void> {
    const tables = await instance.client.query({
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
      query_params: { tables: [...MONITORED_TABLES] },
      unscoped: {
        reason:
          "system.parts carries no tenant column: this is per-table storage size for the operator's dashboards.",
      },
    });
    const tableRows = await tables.json<{
      table: string;
      total_rows: string;
      total_bytes: string;
      parts_count: string;
    }>();

    // Cleared only once the query has resolved, so a failed read keeps the
    // last known values rather than zeroing a live table.
    this.options.metrics.beginTick(instance.target);
    for (const row of tableRows.data) {
      this.options.metrics.recordTable({
        instance: instance.target,
        table: row.table,
        rows: Number.parseInt(row.total_rows, 10),
        bytes: Number.parseInt(row.total_bytes, 10),
        parts: Number.parseInt(row.parts_count, 10),
      });
    }

    await this.collectDisks(instance);
    if (this.options.collectBackups) await this.collectBackups(instance);
  }

  private async collectDisks(instance: StorageStatsInstance): Promise<void> {
    try {
      const disks = await instance.client.query({
        query: `
          SELECT name, total_space, free_space, (total_space - free_space) as used_space
          FROM system.disks
        `,
        unscoped: {
          reason:
            "system.disks carries no tenant column: this is the instance's disk capacity.",
        },
      });
      const rows = await disks.json<{
        name: string;
        total_space: string;
        free_space: string;
        used_space: string;
      }>();
      for (const row of rows.data) {
        this.options.metrics.recordDisk({
          instance: instance.target,
          disk: row.name,
          totalBytes: Number.parseInt(row.total_space, 10),
          usedBytes: Number.parseInt(row.used_space, 10),
          freeBytes: Number.parseInt(row.free_space, 10),
        });
      }
    } catch (error) {
      logger.debug({ error, instance: instance.target }, "failed to collect ClickHouse disk stats");
    }
  }

  /**
   * The backup log, read from `system.backup_log` rather than `system.backups`.
   *
   * `system.backups` is in-memory and is wiped on every ClickHouse restart,
   * which happens on each deploy: a freshly rolled pod would see zero rows,
   * emit no gauge, and trip "Backup Reporting Absent" while backups were
   * perfectly healthy.
   */
  private async collectBackups(instance: StorageStatsInstance): Promise<void> {
    try {
      const backups = await instance.client.query({
        query: `
          SELECT
            status,
            count() as cnt,
            maxIf(end_time, status = 'BACKUP_CREATED') as last_success_time,
            argMaxIf(total_size, end_time, status = 'BACKUP_CREATED') as last_success_size
          FROM system.backup_log
          GROUP BY status
        `,
        unscoped: {
          reason:
            "system.backup_log carries no tenant column: this is the instance's backup history.",
        },
      });
      const rows = await backups.json<{
        status: string;
        cnt: string;
        last_success_time: string;
        last_success_size: string;
      }>();

      for (const row of rows.data) {
        this.options.metrics.recordBackupStatus({
          instance: instance.target,
          status: row.status,
          count: Number.parseInt(row.cnt, 10),
        });
        if (row.status !== "BACKUP_CREATED" || !row.last_success_time) continue;
        const succeededAtSeconds = new Date(row.last_success_time).getTime() / 1000;
        const sizeBytes = Number.parseInt(row.last_success_size, 10);
        if (!Number.isFinite(succeededAtSeconds) || succeededAtSeconds <= 0) continue;
        this.options.metrics.recordLastBackup({
          instance: instance.target,
          succeededAtSeconds,
          sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
        });
      }

      if (this.backupsFailing || this.backupLogAbsent) {
        logger.info({ instance: instance.target }, "ClickHouse backup stats collection recovered");
        this.backupsFailing = false;
        this.backupLogAbsent = false;
      }
    } catch (error) {
      // Collection is opt-OUT (`CLICKHOUSE_BACKUP_METRICS_ENABLED`), so a
      // deployment that never took a backup reaches here with no table to
      // read. That absence is a fact about the instance, not a fault: it is
      // named once at info. A real failure is still edge-triggered, because a
      // warning every fifteen seconds would bury the one that matters.
      if (isMissingBackupLog(error)) {
        if (this.backupLogAbsent) return;
        logger.info(
          { instance: instance.target },
          "ClickHouse has no system.backup_log, so no backup status is collected; this instance has never taken a backup",
        );
        this.backupLogAbsent = true;
        return;
      }
      if (this.backupsFailing) {
        logger.debug({ error }, "failed to collect ClickHouse backup stats");
        return;
      }
      logger.warn(
        { error, instance: instance.target },
        "failed to collect ClickHouse backup stats from system.backup_log (further failures suppressed until recovery)",
      );
      this.backupsFailing = true;
    }
  }
}

/**
 * Whether ClickHouse refused because `system.backup_log` is not there.
 *
 * The table is created by the first backup, so an instance that has never
 * taken one answers `UNKNOWN_TABLE` (error code 60) rather than failing.
 */
function isMissingBackupLog(error: unknown): boolean {
  const detail = error as { code?: unknown; type?: unknown; message?: unknown };
  if (detail?.type === "UNKNOWN_TABLE" || String(detail?.code) === "60") return true;
  return /UNKNOWN_TABLE|Table system\.backup_log (does not|doesn't) exist/i.test(
    typeof detail?.message === "string" ? detail.message : "",
  );
}
