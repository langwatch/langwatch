import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  cond,
  fn,
  systemBackupLog,
  systemDisks,
  systemParts,
  systemTables,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";

import {
  type BackupStatusRow,
  StorageFootprintRepository,
} from "../storage-footprint.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

/** No system table here carries a tenant column: each read spans the server, as the system. */
const systemRead = ({ reason }: { reason: string }) =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason }) });

/** ClickHouse's JSON output sends a UInt64 as a string. */
const toNumber = (value: unknown): number => Number.parseInt(String(value), 10);

/** One endpoint's system tables, read on the system identity (ADR-202). */
export class ClickHouseStorageFootprintRepository extends StorageFootprintRepository {
  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create({
    clickhouse,
  }: {
    clickhouse: Pick<ClickHouseQueryClient, "read">;
  }): ClickHouseStorageFootprintRepository {
    return new ClickHouseStorageFootprintRepository(clickhouse);
  }

  async findTables({
    tables,
  }: {
    tables: readonly string[];
  }): Promise<StorageStatsReading["tables"]> {
    const statement = systemRead({ reason: "per-table storage size for the operator's dashboards" })
      .from(systemParts)
      .select({
        table: systemParts.table,
        total_rows: fn.sum(systemParts.rows),
        total_bytes: fn.sum(systemParts.bytes_on_disk),
        parts_count: fn.count(),
      })
      .where(({ and, eq, oneOf }) =>
        and(
          eq(systemParts.database, fn.currentDatabase()),
          eq(systemParts.active, 1),
          oneOf(systemParts.table, tables),
        ),
      )
      .groupBy(systemParts.table)
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.parts" });
    return rows.map((row) => ({
      table: row.table,
      rows: toNumber(row.total_rows),
      bytes: toNumber(row.total_bytes),
      parts: toNumber(row.parts_count),
    }));
  }

  async findDisks(): Promise<StorageStatsReading["disks"]> {
    const statement = systemRead({ reason: "the instance's disk capacity" })
      .from(systemDisks)
      .select({
        name: systemDisks.name,
        total_space: systemDisks.total_space,
        free_space: systemDisks.free_space,
        used_space: fn.minus(systemDisks.total_space, systemDisks.free_space),
      })
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.disks" });
    return rows.map((row) => ({
      disk: row.name,
      totalBytes: toNumber(row.total_space),
      usedBytes: toNumber(row.used_space),
      freeBytes: toNumber(row.free_space),
    }));
  }

  /** Read from `system.backup_log` rather than `system.backups`. */
  async findBackupStatuses(): Promise<BackupStatusRow[]> {
    if (!(await this.hasBackupLog())) return [];
    const created = cond.eq(systemBackupLog.status, "BACKUP_CREATED");
    const statement = systemRead({ reason: "the instance's backup history" })
      .from(systemBackupLog)
      .select({
        status: systemBackupLog.status,
        cnt: fn.count(),
        last_success_time: fn.maxIf(systemBackupLog.end_time, created),
        last_success_size: fn.argMaxIf(
          systemBackupLog.total_size,
          systemBackupLog.end_time,
          created,
        ),
      })
      .groupBy(systemBackupLog.status)
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.backup_log" });
    return rows.map((row) => ({
      status: row.status,
      count: toNumber(row.cnt),
      lastSuccessTime: String(row.last_success_time),
      lastSuccessSizeBytes: toNumber(row.last_success_size),
    }));
  }

  /** Asked first: a server without the table would log an HTTP error for the query. */
  private async hasBackupLog(): Promise<boolean> {
    const statement = systemRead({ reason: "whether the server keeps a backup log" })
      .from(systemTables)
      .select({ present: fn.count() })
      .where(({ and, eq }) =>
        and(eq(systemTables.database, "system"), eq(systemTables.name, "backup_log")),
      )
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.tables" });
    return toNumber(rows[0]?.present ?? "0") > 0;
  }
}
