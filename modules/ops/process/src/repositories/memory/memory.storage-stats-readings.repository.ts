import {
  type StorageStatsReading,
  StorageStatsReadingsRepository,
} from "../storage-stats-readings.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The shared storage readings in memory, held the way the Redis hashes hold them. */
export class MemoryStorageStatsReadingsRepository extends StorageStatsReadingsRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryStorageStatsReadingsRepository {
    return new MemoryStorageStatsReadingsRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async save({ lastBackup, ...reading }: StorageStatsReading): Promise<void> {
    this.store.storageReadings.set(reading.instance, reading);
    if (lastBackup) this.store.storageLastBackups.set(reading.instance, lastBackup);
  }

  async findAll(): Promise<StorageStatsReading[]> {
    return [...this.store.storageReadings.values()].map((reading) => {
      const lastBackup = this.store.storageLastBackups.get(reading.instance);
      return lastBackup ? { ...reading, lastBackup } : reading;
    });
  }
}
