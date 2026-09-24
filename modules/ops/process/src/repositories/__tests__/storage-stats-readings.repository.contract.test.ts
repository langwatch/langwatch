/**
 * The shared storage readings' contract, run over the memory twin and the Redis repository on a
 * hash-only fake. Spec: modules/ops/specs/storage-stats.feature
 */
import { memoryRedisDouble, memoryRedisStore } from "@langwatch/test-harness/client-doubles/redis";
import type Redis from "ioredis";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../memory/memory.ops.store.ts";
import { MemoryStorageStatsReadingsRepository } from "../memory/memory.storage-stats-readings.repository.ts";
import { RedisStorageStatsReadingsRepository } from "../redis/redis.storage-stats-readings.repository.ts";
import type {
  StorageStatsReading,
  StorageStatsReadingsRepository,
} from "../storage-stats-readings.repository.ts";

/** A never-opened client answering HSET and HGETALL from a map: all the repository asks. */
function hashRedis(): { redis: Redis; hashes: Map<string, Map<string, string>> } {
  const store = memoryRedisStore();
  return { redis: memoryRedisDouble({ store }), hashes: store.hashes };
}

function reading(overrides: Partial<StorageStatsReading> = {}): StorageStatsReading {
  return {
    instance: "shared",
    tables: [{ table: "stored_spans", rows: 10, bytes: 2048, parts: 3 }],
    disks: [{ disk: "default", totalBytes: 100, usedBytes: 60, freeBytes: 40 }],
    backupStatuses: [{ status: "BACKUP_CREATED", count: 2 }],
    ...overrides,
  };
}

function contractCases(repository: () => StorageStatsReadingsRepository): void {
  describe("when a reading is saved", () => {
    it("reads it back for every process", async () => {
      const readings = repository();
      await readings.save(reading({ lastBackup: { succeededAtSeconds: 1_700, sizeBytes: 9 } }));

      expect(await readings.findAll()).toEqual([
        reading({ lastBackup: { succeededAtSeconds: 1_700, sizeBytes: 9 } }),
      ]);
    });
  });

  describe("when the next reading of the same endpoint has no last backup", () => {
    /** @scenario "A measurement whose backup read fails keeps the last backup it knew" */
    it("replaces the tables and keeps the last backup", async () => {
      const readings = repository();
      await readings.save(reading({ lastBackup: { succeededAtSeconds: 1_700, sizeBytes: 9 } }));

      await readings.save(reading({ tables: [], backupStatuses: [] }));

      expect(await readings.findAll()).toEqual([
        reading({
          tables: [],
          backupStatuses: [],
          lastBackup: { succeededAtSeconds: 1_700, sizeBytes: 9 },
        }),
      ]);
    });
  });
}

describe("given the memory twin", () => {
  contractCases(() =>
    MemoryStorageStatsReadingsRepository.create({ store: MemoryOpsStore.create() }),
  );
});

describe("given the Redis repository", () => {
  contractCases(() => RedisStorageStatsReadingsRepository.create({ redis: hashRedis().redis }));

  describe("when a held reading is in a shape this release does not read", () => {
    it("skips it rather than failing every gauge", async () => {
      const { redis, hashes } = hashRedis();
      hashes.set("ops:storage_stats:readings", new Map([["old", '{"rows":1}']]));
      const readings = RedisStorageStatsReadingsRepository.create({ redis });
      await readings.save(reading());

      expect((await readings.findAll()).map((held) => held.instance)).toEqual(["shared"]);
    });
  });
});
