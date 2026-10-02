import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";

import {
  type BackupStatusRow,
  StorageFootprintRepository,
} from "../storage-footprint.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

/** One endpoint's system tables, read unscoped (`tenantId: ""`): none carries a tenant column. */
export class ClickHouseStorageFootprintRepository extends StorageFootprintRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): ClickHouseStorageFootprintRepository {
    return new ClickHouseStorageFootprintRepository(clickhouse);
  }

  async findTables({
    tables,
  }: {
    tables: readonly string[];
  }): Promise<StorageStatsReading["tables"]> {
    const result = await this.clickhouse.query<{
      table: string;
      total_rows: string;
      total_bytes: string;
      parts_count: string;
    }>({
      tenantId: "",
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
      params: { tables: [...tables] },
      unscoped: {
        reason:
          "system.parts carries no tenant column: this is per-table storage size for the operator's dashboards.",
      },
    });
    return result.rows.map((row) => ({
      table: row.table,
      rows: Number.parseInt(row.total_rows, 10),
      bytes: Number.parseInt(row.total_bytes, 10),
      parts: Number.parseInt(row.parts_count, 10),
    }));
  }

  async findDisks(): Promise<StorageStatsReading["disks"]> {
    const result = await this.clickhouse.query<{
      name: string;
      total_space: string;
      free_space: string;
      used_space: string;
    }>({
      tenantId: "",
      sql: `
        SELECT name, total_space, free_space, (total_space - free_space) as used_space
        FROM system.disks
      `,
      unscoped: {
        reason: "system.disks carries no tenant column: this is the instance's disk capacity.",
      },
    });
    return result.rows.map((row) => ({
      disk: row.name,
      totalBytes: Number.parseInt(row.total_space, 10),
      usedBytes: Number.parseInt(row.used_space, 10),
      freeBytes: Number.parseInt(row.free_space, 10),
    }));
  }

  /** Read from `system.backup_log` rather than `system.backups`. */
  async findBackupStatuses(): Promise<BackupStatusRow[]> {
    const result = await this.clickhouse.query<{
      status: string;
      cnt: string;
      last_success_time: string;
      last_success_size: string;
    }>({
      tenantId: "",
      sql: `
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
    return result.rows.map((row) => ({
      status: row.status,
      count: Number.parseInt(row.cnt, 10),
      lastSuccessTime: row.last_success_time,
      lastSuccessSizeBytes: Number.parseInt(row.last_success_size, 10),
    }));
  }
}
