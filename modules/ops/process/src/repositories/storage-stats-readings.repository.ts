import { z } from "zod";

export const storageStatsReadingSchema = z.object({
  instance: z.string(),
  tables: z.array(
    z.object({ table: z.string(), rows: z.number(), bytes: z.number(), parts: z.number() }),
  ),
  disks: z.array(
    z.object({
      disk: z.string(),
      totalBytes: z.number(),
      usedBytes: z.number(),
      freeBytes: z.number(),
    }),
  ),
  backupStatuses: z.array(z.object({ status: z.string(), count: z.number() })),
  lastBackup: z.object({ succeededAtSeconds: z.number(), sizeBytes: z.number() }).optional(),
});

/** One ClickHouse endpoint's storage, as the last measurement of it read it. */
export type StorageStatsReading = z.infer<typeof storageStatsReadingSchema>;

/**
 * The fleet's shared storage readings: one process measures, every process's gauges read. A
 * reading replaces its endpoint's tables, disks and backup counts; a reading without a last
 * backup keeps the one already held, as a failed backup read did before.
 */
export abstract class StorageStatsReadingsRepository {
  abstract save(reading: StorageStatsReading): Promise<void>;
  abstract findAll(): Promise<StorageStatsReading[]>;
}
