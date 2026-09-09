import { observableGauge } from "@langwatch/observability/metrics";

import { StorageStatsMetricsPort } from "../ports/storage-stats-metrics.port.ts";

/**
 * The storage gauges, published on the export interval from the last tick's
 * readings.
 */
export class OtelStorageStatsMetricsAdapter extends StorageStatsMetricsPort {
  static create(): OtelStorageStatsMetricsAdapter {
    return new OtelStorageStatsMetricsAdapter();
  }

  private readonly tables = new Map<
    string,
    { instance: string; table: string; rows: number; bytes: number; parts: number }
  >();
  private readonly disks = new Map<
    string,
    { instance: string; disk: string; totalBytes: number; usedBytes: number; freeBytes: number }
  >();
  private readonly backupStatuses = new Map<
    string,
    { instance: string; status: string; count: number }
  >();
  private readonly lastBackups = new Map<
    string,
    { instance: string; succeededAtSeconds: number; sizeBytes: number }
  >();

  private constructor() {
    super();
    this.publish();
  }

  beginTick(instance: string): void {
    for (const map of [this.tables, this.disks, this.backupStatuses]) {
      for (const [key, value] of map) {
        if (value.instance === instance) map.delete(key);
      }
    }
  }

  recordTable(input: {
    instance: string;
    table: string;
    rows: number;
    bytes: number;
    parts: number;
  }): void {
    this.tables.set(`${input.instance}\u0000${input.table}`, input);
  }

  recordDisk(input: {
    instance: string;
    disk: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  }): void {
    this.disks.set(`${input.instance}\u0000${input.disk}`, input);
  }

  recordBackupStatus(input: { instance: string; status: string; count: number }): void {
    this.backupStatuses.set(`${input.instance}\u0000${input.status}`, input);
  }

  recordLastBackup(input: {
    instance: string;
    succeededAtSeconds: number;
    sizeBytes: number;
  }): void {
    this.lastBackups.set(input.instance, input);
  }

  private publish(): void {
    observableGauge(
      { name: "clickhouse_table_rows", description: "Rows in a monitored ClickHouse table" },
      (observer) => {
        for (const row of this.tables.values()) {
          observer.observe(row.rows, { instance: row.instance, table: row.table });
        }
      },
    );
    observableGauge(
      {
        name: "clickhouse_table_bytes",
        description: "On-disk size of a monitored ClickHouse table in bytes",
      },
      (observer) => {
        for (const row of this.tables.values()) {
          observer.observe(row.bytes, { instance: row.instance, table: row.table });
        }
      },
    );
    observableGauge(
      { name: "clickhouse_table_parts", description: "Active parts in a monitored table" },
      (observer) => {
        for (const row of this.tables.values()) {
          observer.observe(row.parts, { instance: row.instance, table: row.table });
        }
      },
    );
    observableGauge(
      { name: "clickhouse_disk_total_bytes", description: "Total space on a ClickHouse disk" },
      (observer) => {
        for (const row of this.disks.values()) {
          observer.observe(row.totalBytes, { instance: row.instance, disk: row.disk });
        }
      },
    );
    observableGauge(
      { name: "clickhouse_disk_used_bytes", description: "Used space on a ClickHouse disk" },
      (observer) => {
        for (const row of this.disks.values()) {
          observer.observe(row.usedBytes, { instance: row.instance, disk: row.disk });
        }
      },
    );
    observableGauge(
      { name: "clickhouse_disk_free_bytes", description: "Free space on a ClickHouse disk" },
      (observer) => {
        for (const row of this.disks.values()) {
          observer.observe(row.freeBytes, { instance: row.instance, disk: row.disk });
        }
      },
    );
    observableGauge(
      {
        name: "clickhouse_backup_status_total",
        description: "Backup log entries by terminal status",
      },
      (observer) => {
        for (const row of this.backupStatuses.values()) {
          observer.observe(row.count, { instance: row.instance, status: row.status });
        }
      },
    );
    observableGauge(
      {
        name: "clickhouse_backup_last_success_timestamp_seconds",
        description: "When the last ClickHouse backup succeeded, in Unix seconds",
      },
      (observer) => {
        for (const row of this.lastBackups.values()) {
          observer.observe(row.succeededAtSeconds, { instance: row.instance });
        }
      },
    );
    observableGauge(
      {
        name: "clickhouse_backup_last_size_bytes",
        description: "Size of the last successful ClickHouse backup in bytes",
      },
      (observer) => {
        for (const row of this.lastBackups.values()) {
          observer.observe(row.sizeBytes, { instance: row.instance });
        }
      },
    );
  }
}
