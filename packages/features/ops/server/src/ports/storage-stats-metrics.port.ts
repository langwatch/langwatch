/**
 * Where a storage-stats tick writes what it read.
 *
 * A port rather than direct instruments because the numbers are gauges, and a
 * gauge only ever writes: a table that TTL-drops to zero active parts, or is
 * simply absent from one tick's answer, would otherwise publish its last
 * non-zero value forever. `beginTick` is what lets the adapter forget the
 * previous tick's series before the new ones land, so a phantom table cannot
 * outlive its data on a size alert.
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
