/**
 * Where a storage-stats tick writes what it read.
 */
export abstract class StorageStatsMetricsPort {
  /** Clears the per-table and per-disk series this tick is about to rewrite. */
  abstract beginTick(instance: string): void;

  abstract recordTable(input: {
    instance: string;
    table: string;
    rows: number;
    bytes: number;
    parts: number;
  }): void;

  abstract recordDisk(input: {
    instance: string;
    disk: string;
    totalBytes: number;
    usedBytes: number;
    freeBytes: number;
  }): void;

  abstract recordBackupStatus(input: { instance: string; status: string; count: number }): void;

  abstract recordLastBackup(input: {
    instance: string;
    succeededAtSeconds: number;
    sizeBytes: number;
  }): void;
}
