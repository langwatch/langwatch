import type { StorageStatsReading } from "./storage-stats-readings.repository.ts";

/** A cluster name is spliced as an identifier, so only a plain one is trusted. */
export function isPlainClusterName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

/** One status in a ClickHouse endpoint's backup log, with its last success where it has one. */
export interface BackupStatusRow {
  status: string;
  count: number;
  /** ClickHouse's own time string; empty or a zero time where no backup succeeded. */
  lastSuccessTime: string;
  /** NaN where ClickHouse returned no size. */
  lastSuccessSizeBytes: number;
}

/**
 * What one ClickHouse endpoint holds on disk, read from its system tables. Every read resolves or
 * throws; the collection decides what a throw means.
 */
export abstract class StorageFootprintRepository {
  /** The active parts of each named table, summed; a table with no parts is absent. */
  abstract findTables(input: { tables: readonly string[] }): Promise<StorageStatsReading["tables"]>;
  abstract findDisks(): Promise<StorageStatsReading["disks"]>;
  /**
   * Backup history. `cluster` names the replicas to read together: `system.backup_log` is
   * per-replica and backups run on one of them, so a single replica's answer can be weeks stale.
   * Absent reads the endpoint's own log (single node, self-hosted).
   */
  abstract findBackupStatuses(input?: { cluster?: string | undefined }): Promise<BackupStatusRow[]>;
}
