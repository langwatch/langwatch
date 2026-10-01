/**
 * What the install's ClickHouse is actually holding.
 * @see specs/ops/clickhouse-storage-metrics.feature
 */

import type { Logger } from "@langwatch/observability";
import { toEpochMs } from "@langwatch/time";

import type {
  StorageStatsReading,
  StorageStatsReadingsRepository,
} from "../repositories/storage-stats-readings.repository.ts";

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

/** The narrow read a system-table query needs, as this service asks it. */
export interface StorageStatsClickHouseClient {
  query<Row>(input: {
    query: string;
    query_params?: Record<string, readonly string[]>;
    /** Set when the statement genuinely spans tenants; see the tenant-scope guard. */
    unscoped?: { reason: string };
  }): Promise<{ data: Row[] }>;
}

export interface StorageStatsInstance {
  target: string;
  client: StorageStatsClickHouseClient;
}

export interface StorageStatsCollectionOptions {
  resolveInstances: () => Promise<readonly StorageStatsInstance[]>;
  /** Where each endpoint's reading goes, for every process's gauges to read. */
  readings: StorageStatsReadingsRepository;
  /** Whether the backup log is read at all. */
  collectBackups: boolean;
  logger: Pick<Logger, "debug" | "info" | "warn" | "error">;
}

export class StorageStatsCollectionService {
  static create(options: StorageStatsCollectionOptions): StorageStatsCollectionService {
    return new StorageStatsCollectionService(options);
  }

  private backupsFailing = false;
  private backupLogAbsent = false;

  private constructor(private readonly options: StorageStatsCollectionOptions) {}

  /** One pass over every configured endpoint; each `ops_storage_stats` wake runs one. */
  async collect(): Promise<void> {
    let instances: readonly StorageStatsInstance[];
    try {
      instances = await this.options.resolveInstances();
    } catch (error) {
      this.options.logger.error(
        { error },
        "could not enumerate ClickHouse endpoints for storage stats",
      );

      return;
    }

    // Per endpoint, never all-or-nothing: one unreachable private ClickHouse
    // must not take the shared endpoint's numbers off the dashboards with it.
    for (const instance of instances) {
      try {
        await this.collectInstance(instance);
      } catch (error) {
        this.options.logger.error(
          { error, instance: instance.target },
          "failed to collect ClickHouse storage stats",
        );
      }
    }
  }

  private async collectInstance(instance: StorageStatsInstance): Promise<void> {
    const tableRows = await instance.client.query<{
      table: string;
      total_rows: string;
      total_bytes: string;
      parts_count: string;
    }>({
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

    // Saved only once the table read has resolved, so a failed read keeps the
    // last known values rather than zeroing a live table.
    const reading: StorageStatsReading = {
      instance: instance.target,
      tables: tableRows.data.map((row) => ({
        table: row.table,
        rows: Number.parseInt(row.total_rows, 10),
        bytes: Number.parseInt(row.total_bytes, 10),
        parts: Number.parseInt(row.parts_count, 10),
      })),
      disks: await this.readDisks(instance),
      backupStatuses: [],
    };
    if (this.options.collectBackups) {
      await this.readBackups({ instance, reading });
    }

    await this.options.readings.save(reading);
  }

  private async readDisks(instance: StorageStatsInstance): Promise<StorageStatsReading["disks"]> {
    try {
      const rows = await instance.client.query<{
        name: string;
        total_space: string;
        free_space: string;
        used_space: string;
      }>({
        query: `
          SELECT name, total_space, free_space, (total_space - free_space) as used_space
          FROM system.disks
        `,
        unscoped: {
          reason: "system.disks carries no tenant column: this is the instance's disk capacity.",
        },
      });
      return rows.data.map((row) => ({
        disk: row.name,
        totalBytes: Number.parseInt(row.total_space, 10),
        usedBytes: Number.parseInt(row.used_space, 10),
        freeBytes: Number.parseInt(row.free_space, 10),
      }));
    } catch (error) {
      this.options.logger.debug(
        { error, instance: instance.target },
        "failed to collect ClickHouse disk stats",
      );
      return [];
    }
  }

  /**
   * The backup log, read from `system.backup_log` rather than `system.backups`.
   */
  private async readBackups({
    instance,
    reading,
  }: {
    instance: StorageStatsInstance;
    reading: StorageStatsReading;
  }): Promise<void> {
    try {
      const rows = await instance.client.query<{
        status: string;
        cnt: string;
        last_success_time: string;
        last_success_size: string;
      }>({
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

      for (const row of rows.data) {
        this.readBackupRow({ reading, row });
      }

      if (this.backupsFailing || this.backupLogAbsent) {
        this.options.logger.info(
          { instance: instance.target },
          "ClickHouse backup stats collection recovered",
        );
        this.backupsFailing = false;
        this.backupLogAbsent = false;
      }
    } catch (error) {
      this.reportBackupFailure({ instance, error });
    }
  }

  /** One status row: its count always, and the last success only when it names a real time. */
  private readBackupRow({
    reading,
    row,
  }: {
    reading: StorageStatsReading;
    row: { status: string; cnt: string; last_success_time: string; last_success_size: string };
  }): void {
    reading.backupStatuses.push({ status: row.status, count: Number.parseInt(row.cnt, 10) });
    if (row.status !== "BACKUP_CREATED" || !row.last_success_time) {
      return;
    }

    const succeededAtSeconds = toEpochMs(row.last_success_time) / 1000;
    if (!Number.isFinite(succeededAtSeconds) || succeededAtSeconds <= 0) {
      return;
    }

    const sizeBytes = Number.parseInt(row.last_success_size, 10);
    reading.lastBackup = {
      succeededAtSeconds,
      sizeBytes: Number.isFinite(sizeBytes) ? sizeBytes : 0,
    };
  }

  /**
   * Collection is opt-out, so a deployment that never took a backup reaches here with no table to
   * read. That absence is a fact about the instance, not a fault, and is named once at info; a
   * real failure is edge-triggered too, since a warning every fifteen seconds buries the real one.
   */
  private reportBackupFailure({
    instance,
    error,
  }: {
    instance: StorageStatsInstance;
    error: unknown;
  }): void {
    if (isMissingBackupLog(error)) {
      if (this.backupLogAbsent) {
        return;
      }

      this.options.logger.info(
        { instance: instance.target },
        "ClickHouse has no system.backup_log, so no backup status is collected; this instance has never taken a backup",
      );
      this.backupLogAbsent = true;

      return;
    }

    if (this.backupsFailing) {
      this.options.logger.debug({ error }, "failed to collect ClickHouse backup stats");

      return;
    }

    this.options.logger.warn(
      { error, instance: instance.target },
      "failed to collect ClickHouse backup stats from system.backup_log (further failures suppressed until recovery)",
    );
    this.backupsFailing = true;
  }
}

/**
 * Whether ClickHouse refused because `system.backup_log` is not there.
 */
function isMissingBackupLog(error: unknown): boolean {
  const detail = error as { code?: unknown; type?: unknown; message?: unknown };
  if (detail?.type === "UNKNOWN_TABLE" || String(detail?.code) === "60") {
    return true;
  }

  return /UNKNOWN_TABLE|Table system\.backup_log (does not|doesn't) exist/i.test(
    typeof detail?.message === "string" ? detail.message : "",
  );
}
