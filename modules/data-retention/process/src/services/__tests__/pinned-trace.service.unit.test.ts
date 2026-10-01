import { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { describe, expect, it } from "vitest";

import {
  createDataRetentionTestOrganizations,
  createDataRetentionTestProjects,
  retentionTestGraph,
} from "../../app/__tests__/data-retention.fixture.ts";
import { MemoryDataRetentionRepository } from "../../repositories/memory/memory.data-retention.repository.ts";
import { MemoryPinnedTraceRepository } from "../../repositories/memory/memory.pinned-trace.repository.ts";
import { RedisDataRetentionCacheRepository } from "../../repositories/redis/redis.data-retention-cache.repository.ts";
import { RedisStorageMeterCacheRepository } from "../../repositories/redis/redis.storage-meter-cache.repository.ts";
import type { RetroactiveRetentionRepository } from "../../repositories/retroactive-retention.repository.ts";
import { STORAGE_METER_CACHE_TTL_MS } from "../../repositories/storage-meter-cache.repository.ts";
import { DataRetentionService } from "../data-retention.service.ts";
import { StorageMeterService } from "../storage-meter.service.ts";

const PROJECT = retentionTestGraph.projectId;
const TRACE = "trace-1";

/**
 * The ClickHouse seam. Pinning is an annotation, so nothing on this repository
 * may be reached by a pin — which is what the test below asserts rather than
 * assumes.
 */
class RecordingRetroactive implements RetroactiveRetentionRepository {
  readonly calls: string[] = [];

  async triggerUpdate(): Promise<{ tables: string[] }> {
    this.calls.push("triggerUpdate");

    return { tables: [] };
  }

  async findMutationProgress(): Promise<never[]> {
    this.calls.push("getMutationProgress");

    return [];
  }

  async killMutation(): Promise<void> {
    this.calls.push("killMutation");
  }
}

/** No statement this suite issues ever reaches a server. */
const noopClickHouse = new ClickHouseQueryClient({
  driver: {
    execute: async () => ({ rows: [] }),
    insert: async () => {},
    command: async () => {},
  },
});

function createService(retroactive: RetroactiveRetentionRepository = new RecordingRetroactive()) {
  return DataRetentionService.create({
    policies: MemoryDataRetentionRepository.create(),
    pins: MemoryPinnedTraceRepository.create(),
    projects: createDataRetentionTestProjects(),
    organizations: createDataRetentionTestOrganizations(),
    defaultRetentionDays: 49,
    retroactive,
    cache: RedisDataRetentionCacheRepository.create({ redis: null, ttlMs: 1_000 }),
    storageMeter: StorageMeterService.create({
      clickhouse: noopClickHouse,
      cache: RedisStorageMeterCacheRepository.create({ ttlMs: STORAGE_METER_CACHE_TTL_MS }),
    }),
  });
}

describe("DataRetentionService pin lifecycle", () => {
  describe("when a person pins a trace", () => {
    /** @scenario "Pinning a trace does not change retention" */
    it("records the pin and issues no ClickHouse retention command", async () => {
      const retroactive = new RecordingRetroactive();
      const service = createService(retroactive);

      await service.pin({ projectId: PROJECT, traceId: TRACE });

      await expect(service.isPinned({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(true);
      expect(retroactive.calls).toEqual([]);
    });
  });

  describe("when an auto-shared trace is unshared", () => {
    /**
     * @scenario "Manual pins survive share removal"
     * @scenario Manual pin survives unsharing an auto-shared trace
     */
    it("keeps a manual pin when auto-unpin runs", async () => {
      const service = createService();

      await service.autoPin({ projectId: PROJECT, traceId: TRACE });
      await service.pin({ projectId: PROJECT, traceId: TRACE });
      await service.autoUnpin({ projectId: PROJECT, traceId: TRACE });

      await expect(service.isPinned({ projectId: PROJECT, traceId: TRACE })).resolves.toBe(true);
    });
  });
});
