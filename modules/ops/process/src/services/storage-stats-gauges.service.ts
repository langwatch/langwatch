import { createLogger } from "@langwatch/observability";
import { type GaugeObserver, observableGauge } from "@langwatch/observability/metrics";

import type {
  StorageStatsReading,
  StorageStatsReadingsRepository,
} from "../repositories/storage-stats-readings.repository.ts";

const logger = createLogger("langwatch:ops:storage-stats");

type Observe = (observer: GaugeObserver, reading: StorageStatsReading) => void;

/**
 * The storage gauges every process exports, read on the export interval from the fleet's shared
 * readings, so each replica reports what the one measuring process last saw.
 */
export class StorageStatsGaugesService {
  static create({
    readings,
  }: {
    readings: StorageStatsReadingsRepository;
  }): StorageStatsGaugesService {
    return new StorageStatsGaugesService(readings);
  }

  private constructor(private readonly readings: StorageStatsReadingsRepository) {}

  private gauge({
    name,
    description,
    observe,
  }: {
    name: string;
    description: string;
    observe: Observe;
  }): void {
    observableGauge({ name, description }, async (observer) => {
      for (const reading of await this.read()) observe(observer, reading);
    });
  }

  private async read(): Promise<StorageStatsReading[]> {
    try {
      return await this.readings.findAll();
    } catch (error) {
      logger.debug({ error }, "failed to read the shared storage readings");
      return [];
    }
  }

  /** Registers the nine gauges against the shared readings. */
  publish(): void {
    const perTable =
      (value: (table: StorageStatsReading["tables"][number]) => number): Observe =>
      (observer, reading) => {
        for (const table of reading.tables) {
          observer.observe(value(table), { instance: reading.instance, table: table.table });
        }
      };
    const perDisk =
      (value: (disk: StorageStatsReading["disks"][number]) => number): Observe =>
      (observer, reading) => {
        for (const disk of reading.disks) {
          observer.observe(value(disk), { instance: reading.instance, disk: disk.disk });
        }
      };
    const lastBackup =
      (value: (backup: NonNullable<StorageStatsReading["lastBackup"]>) => number): Observe =>
      (observer, reading) => {
        if (reading.lastBackup) {
          observer.observe(value(reading.lastBackup), { instance: reading.instance });
        }
      };

    this.gauge({
      name: "clickhouse_table_rows",
      description: "Rows in a monitored ClickHouse table",
      observe: perTable((table) => table.rows),
    });
    this.gauge({
      name: "clickhouse_table_bytes",
      description: "On-disk size of a monitored ClickHouse table in bytes",
      observe: perTable((table) => table.bytes),
    });
    this.gauge({
      name: "clickhouse_table_parts",
      description: "Active parts in a monitored table",
      observe: perTable((table) => table.parts),
    });
    this.gauge({
      name: "clickhouse_disk_total_bytes",
      description: "Total space on a ClickHouse disk",
      observe: perDisk((disk) => disk.totalBytes),
    });
    this.gauge({
      name: "clickhouse_disk_used_bytes",
      description: "Used space on a ClickHouse disk",
      observe: perDisk((disk) => disk.usedBytes),
    });
    this.gauge({
      name: "clickhouse_disk_free_bytes",
      description: "Free space on a ClickHouse disk",
      observe: perDisk((disk) => disk.freeBytes),
    });
    this.gauge({
      name: "clickhouse_backup_status_total",
      description: "Backup log entries by terminal status",
      observe: (observer, reading) => {
        for (const backup of reading.backupStatuses) {
          observer.observe(backup.count, { instance: reading.instance, status: backup.status });
        }
      },
    });
    this.gauge({
      name: "clickhouse_backup_last_success_timestamp_seconds",
      description: "When the last ClickHouse backup succeeded, in Unix seconds",
      observe: lastBackup((backup) => backup.succeededAtSeconds),
    });
    this.gauge({
      name: "clickhouse_backup_last_size_bytes",
      description: "Size of the last successful ClickHouse backup in bytes",
      observe: lastBackup((backup) => backup.sizeBytes),
    });
  }
}
