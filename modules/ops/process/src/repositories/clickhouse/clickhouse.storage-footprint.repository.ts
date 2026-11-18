import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  clickhouseRead,
  cond,
  everyReplica,
  fn,
  systemBackupLog,
  systemDisks,
  systemParts,
  systemTables,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";

import { isPlainClusterName, isUnknownClusterError } from "../../rules/cluster-name.rules.ts";
import {
  type BackupStatusRow,
  StorageFootprintRepository,
} from "../storage-footprint.repository.ts";
import type { StorageStatsReading } from "../storage-stats-readings.repository.ts";

const logger = createLogger("langwatch:ops:storage-footprint");

/** No system table here carries a tenant column: each read spans the server, as the system. */
const systemRead = ({ reason }: { reason: string }) =>
  clickhouseRead({ scope: tenantScope.allTenants({ reason }) });

/** ClickHouse's JSON output sends a UInt64 as a string. */
const toNumber = (value: unknown): number => Number.parseInt(String(value), 10);

/** One endpoint's system tables, read on the system identity (ADR-202). */
export class ClickHouseStorageFootprintRepository extends StorageFootprintRepository {
  private warnedUnknownCluster = false;

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
      count: toNumber(row.cnt),
      lastSuccessTime: String(row.last_success_time),
      lastSuccessSizeBytes: toNumber(row.last_success_size),
    }));
  }

  /**
   * The read across the cluster, or on the local node when ClickHouse does not know the cluster;
   * that degradation is logged once per streak. Any other failure goes to the collector.
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
      const answer = await read(cluster);
      this.warnedUnknownCluster = false;
      return { answer, cluster };
    } catch (error) {
      if (!isUnknownClusterError(error)) throw error;
      // Once per streak: the setting stays wrong until an operator fixes it.
      const level = this.warnedUnknownCluster ? "debug" : "warn";
      this.warnedUnknownCluster = true;
      logger[level](
        { cluster, error },
        "ClickHouse does not know the configured cluster; reading the local node's backup log",
      );
      return { answer: await read(void 0), cluster: void 0 };
    }
  }

  private async readBackupRows({ cluster }: { cluster: string | undefined }) {
    const name = plainClusterName(cluster);
    const created = cond.eq(systemBackupLog.status, "BACKUP_CREATED");
    const statement = systemRead({ reason: "the instance's backup history" })
      .from(name ? everyReplica({ table: systemBackupLog, cluster: name }) : systemBackupLog)
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
      .settings(clusterSettings(cluster))
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.backup_log" });
    return rows;
  }

  /** Asked first: a server without the table would log an HTTP error for the query. */
  private async hasBackupLog({ cluster }: { cluster?: string | undefined }): Promise<boolean> {
    const name = plainClusterName(cluster);
    const statement = systemRead({ reason: "whether the server keeps a backup log" })
      .from(name ? everyReplica({ table: systemTables, cluster: name }) : systemTables)
      .select({ present: fn.count() })
      .where(({ and, eq }) =>
        and(eq(systemTables.database, "system"), eq(systemTables.name, "backup_log")),
      )
      .settings(clusterSettings(cluster))
      .build();
    const { rows } = await this.clickhouse.read({ statement, table: "system.tables" });
    return toNumber(rows[0]?.present ?? 0) > 0;
  }
}

/** The trusted cluster name, or an empty string where none is named or it is not plain. */
function plainClusterName(cluster: string | undefined): string {
  const name = cluster?.trim() ?? "";
  return isPlainClusterName(name) ? name : "";
}

/** One unreachable replica must not blank the reading the others can still answer. */
function clusterSettings(cluster: string | undefined): Record<string, number> {
  return plainClusterName(cluster) ? { skip_unavailable_shards: 1 } : {};
}
