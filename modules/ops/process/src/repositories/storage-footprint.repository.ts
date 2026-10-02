import type { StorageStatsReading } from "./storage-stats-readings.repository.ts";

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
  abstract findBackupStatuses(): Promise<BackupStatusRow[]>;
}
