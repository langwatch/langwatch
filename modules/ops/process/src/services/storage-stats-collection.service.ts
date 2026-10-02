/**
 * What the install's ClickHouse is actually holding.
 * @see specs/ops/clickhouse-storage-metrics.feature
 */

import type { Logger } from "@langwatch/observability";
import { toEpochMs } from "@langwatch/time";

import type {
  BackupStatusRow,
  StorageFootprintRepository,
} from "../repositories/storage-footprint.repository.ts";
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

/** One ClickHouse endpoint the collection measures, read through its own footprint repository. */
export interface StorageStatsInstance {
  target: string;
  storage: StorageFootprintRepository;
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
    const tables = await instance.storage.findTables({ tables: MONITORED_TABLES });

    // Saved only once the table read has resolved, so a failed read keeps the
    // last known values rather than zeroing a live table.
    const reading: StorageStatsReading = {
      instance: instance.target,
      tables,
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
      return await instance.storage.findDisks();
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
      const rows = await instance.storage.findBackupStatuses();

      for (const row of rows) {
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
    row: BackupStatusRow;
  }): void {
    reading.backupStatuses.push({ status: row.status, count: row.count });
    if (row.status !== "BACKUP_CREATED" || !row.lastSuccessTime) {
      return;
    }

    const succeededAtSeconds = toEpochMs(row.lastSuccessTime) / 1000;
    if (!Number.isFinite(succeededAtSeconds) || succeededAtSeconds <= 0) {
      return;
    }

    reading.lastBackup = {
      succeededAtSeconds,
      sizeBytes: Number.isFinite(row.lastSuccessSizeBytes) ? row.lastSuccessSizeBytes : 0,
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
