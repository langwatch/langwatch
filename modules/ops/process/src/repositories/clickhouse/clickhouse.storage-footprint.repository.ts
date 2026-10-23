import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";

import { isClusterReadRefusal, isPlainClusterName } from "../../rules/cluster-name.rules.ts";
import {
  type BackupStatusRow,
  StorageFootprintRepository,
} from "../storage-footprint.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

const logger = createLogger("langwatch:ops:storage-footprint");

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
      // System.parts carries no tenant column: this is per-table storage size for the operator's
      // dashboards.
      SKIP_TENANT_CHECK: true,
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
      // System.disks carries no tenant column: this is the instance's disk capacity.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows.map((row) => ({
      disk: row.name,
      totalBytes: Number.parseInt(row.total_space, 10),
      usedBytes: Number.parseInt(row.used_space, 10),
      freeBytes: Number.parseInt(row.free_space, 10),
    }));
  }

  /**
   * Read from `system.backup_log` rather than `system.backups`. With a cluster, every replica's
   * log is read and merged: the backup runs on one replica, the app may be connected to another.
   */
  async findBackupStatuses({ cluster }: { cluster?: string | undefined } = {}): Promise<
    BackupStatusRow[]
  > {
    const named = await this.orLocal({
      cluster,
      read: (source) => this.hasBackupLog({ cluster: source }),
    });
    if (!named.answer) return [];
    const { answer: rows } = await this.orLocal({
      cluster: named.cluster,
      read: (source) => this.readBackupRows({ cluster: source }),
    });
    return rows.map((row) => ({
      status: row.status,
      count: Number.parseInt(row.cnt, 10),
      lastSuccessTime: row.last_success_time,
      lastSuccessSizeBytes: Number.parseInt(row.last_success_size, 10),
    }));
  }

  /**
   * The read across the cluster, or on the local node when the cluster refuses it in a way the
   * local node can still answer; that degradation is logged, and any other failure is thrown.
   */
  private async orLocal<T>({
    cluster,
    read,
  }: {
    cluster: string | undefined;
    read: (cluster: string | undefined) => Promise<T>;
  }): Promise<{ answer: T; cluster: string | undefined }> {
    if (!plainClusterName(cluster)) return { answer: await read(void 0), cluster: void 0 };
    try {
      return { answer: await read(cluster), cluster };
    } catch (error) {
      if (!isClusterReadRefusal(error)) throw error;
      logger.warn(
        { cluster, error },
        "ClickHouse refused the cluster-wide backup read; reading the local node's backup log",
      );
      return { answer: await read(void 0), cluster: void 0 };
    }
  }

  private async readBackupRows({ cluster }: { cluster: string | undefined }) {
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
        FROM ${backupLogSource(cluster)}
        GROUP BY status
        ${clusterSettings(cluster)}
      `,
      // System.backup_log carries no tenant column: this is the instance's backup history.
      SKIP_TENANT_CHECK: true,
    });
    return result.rows;
  }

  /** Asked first: a server without the table would log an HTTP error for the query. */
  private async hasBackupLog({ cluster }: { cluster?: string | undefined }): Promise<boolean> {
    const result = await this.clickhouse.query<{ present: string }>({
      tenantId: "",
      sql: `SELECT count() AS present FROM ${systemTablesSource(cluster)}
        WHERE database = 'system' AND name = 'backup_log' ${clusterSettings(cluster)}`,
      // System.tables carries no tenant column: this asks what the server has.
      SKIP_TENANT_CHECK: true,
    });
    return Number.parseInt(result.rows[0]?.present ?? "0", 10) > 0;
  }
}

/** The trusted cluster name, or an empty string where none is named or it is not plain. */
function plainClusterName(cluster: string | undefined): string {
  const name = cluster?.trim() ?? "";
  return isPlainClusterName(name) ? name : "";
}

function backupLogSource(cluster: string | undefined): string {
  const name = plainClusterName(cluster);
  return name ? `clusterAllReplicas('${name}', system.backup_log)` : "system.backup_log";
}

function systemTablesSource(cluster: string | undefined): string {
  const name = plainClusterName(cluster);
  return name ? `clusterAllReplicas('${name}', system.tables)` : "system.tables";
}

/** One unreachable replica must not blank the reading the others can still answer. */
function clusterSettings(cluster: string | undefined): string {
  return plainClusterName(cluster) ? "SETTINGS skip_unavailable_shards = 1" : "";
}
