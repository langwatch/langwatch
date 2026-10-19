import { createLogger } from "@langwatch/observability";
import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import {
  type StorageStatsReading,
  StorageStatsReadingsRepository,
  storageStatsReadingSchema,
} from "../storage-stats-readings.repository.ts";

const logger = createLogger("langwatch:ops:storage-stats");

const heldReadingSchema = storageStatsReadingSchema.omit({ lastBackup: true });
const lastBackupSchema = storageStatsReadingSchema.shape.lastBackup.unwrap();

/** Two hashes keyed by endpoint: the replaced-each-time reading, and the last backup kept apart. */
export class RedisStorageStatsReadingsRepository extends StorageStatsReadingsRepository {
  private static readonly readingsKey = "ops:storage_stats:readings";
  private static readonly lastBackupsKey = "ops:storage_stats:last_backup";

  static create({ redis }: { redis: IORedis | Cluster }): RedisStorageStatsReadingsRepository {
    return new RedisStorageStatsReadingsRepository(redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async save({ lastBackup, ...reading }: StorageStatsReading): Promise<void> {
    const pipe = this.redis.pipeline();
    pipe.hset(RedisStorageStatsReadingsRepository.readingsKey, {
      [reading.instance]: JSON.stringify(reading),
    });
    if (lastBackup) {
      pipe.hset(RedisStorageStatsReadingsRepository.lastBackupsKey, {
        [reading.instance]: JSON.stringify(lastBackup),
      });
    }
    await pipe.exec();
  }

  async findAll(): Promise<StorageStatsReading[]> {
    const [readings, lastBackups] = await Promise.all([
      this.redis.hgetall(RedisStorageStatsReadingsRepository.readingsKey),
      this.redis.hgetall(RedisStorageStatsReadingsRepository.lastBackupsKey),
    ]);

    return Object.entries(readings).flatMap(([instance, raw]) => {
      const reading = heldReadingSchema.safeParse(readJson(raw));
      if (!reading.success) {
        logger.debug({ instance }, "skipped a storage reading held in another shape");
        return [];
      }

      const lastBackup = lastBackupSchema.safeParse(readJson(lastBackups[instance]));
      return [lastBackup.success ? { ...reading.data, lastBackup: lastBackup.data } : reading.data];
    });
  }
}

/** Held JSON, or nothing the schemas accept when the field is absent or unparseable. */
function readJson(raw: string | undefined): unknown {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}
