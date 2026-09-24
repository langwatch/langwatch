/** Spec: modules/ops/specs/storage-stats.feature */
import { InMemoryProcessStore } from "@langwatch/eventing";
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it, vi } from "vitest";

import { opsServer } from "../../ops.server.ts";
import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryStorageStatsReadingsRepository } from "../../repositories/memory/memory.storage-stats-readings.repository.ts";
import {
  type StorageStatsClickHouseClient,
  StorageStatsCollectionService,
} from "../../services/storage-stats-collection.service.ts";
import { STORAGE_STATS_PROCESS_NAME } from "../ops-storage-stats.intent.ts";
import {
  STORAGE_STATS_PIPELINE_NAME,
  buildStorageStats,
  storageStatsEventing,
} from "../ops-storage-stats.pipeline.ts";
import { storageStatsWake } from "../ops-storage-stats.process.ts";

const NOW = Date.parse("2026-09-23T12:00:00Z");

function built(measureStorage: () => Promise<void>) {
  const processStore = InMemoryProcessStore.createForTesting();
  const definition = buildStorageStats({
    participation: "consume",
    repositories: undefined,
    app: { measureStorage },
    processStore,
  });
  const process = definition.processManagers.get(STORAGE_STATS_PROCESS_NAME);
  if (!process) throw new Error("the declaration built no storage-stats process manager");
  return { definition, process };
}

async function deliver(process: ReturnType<typeof built>["process"], at: number) {
  await process.config.intents!.measure!.run(
    { scheduledFor: at },
    {
      processName: STORAGE_STATS_PROCESS_NAME,
      projectId: "global",
      processKey: "global",
      tenantId: "global",
      messageKey: `measure:${at}`,
      attempt: 1,
    },
  );
}

function wake(at: number) {
  return storageStatsWake(
    { lastMeasuredAt: null },
    {
      at,
      now: at,
      key: STORAGE_STATS_PROCESS_NAME,
      projectId: "__global__",
      intents: {
        measure: (messageKey, payload) => ({ messageKey, intentType: "measure", payload }),
      },
    },
  );
}

describe("given ops's storage-stats declaration", () => {
  /** @scenario "Storage is measured every fifteen seconds as a scheduled process" */
  it("is installed with the module and wakes every fifteen seconds", () => {
    const { definition, process } = built(async () => undefined);

    expect(storageStatsEventing.pipeline).toBe(STORAGE_STATS_PIPELINE_NAME);
    expect(opsServer.eventing?.pipeline.split(", ")).toContain(STORAGE_STATS_PIPELINE_NAME);
    expect(definition.metadata.name).toBe(STORAGE_STATS_PIPELINE_NAME);
    expect(process.config.schedule?.everyMs).toBe(15_000);
  });

  /** @scenario "Storage is measured every fifteen seconds as a scheduled process" */
  it("asks for one measurement per wake, keyed by the wake", () => {
    const first = wake(NOW);

    expect(first.intents).toHaveLength(1);
    expect(first.intents?.[0]?.messageKey).toBe(wake(NOW).intents?.[0]?.messageKey);
    expect(wake(NOW + 15_000).intents?.[0]?.messageKey).not.toBe(first.intents?.[0]?.messageKey);
  });

  describe("when a measurement is delivered", () => {
    /** @scenario "A measurement saves each endpoint's reading to the shared readings" */
    it("saves the endpoint's reading where every process reads it", async () => {
      const readings = MemoryStorageStatsReadingsRepository.create({
        store: MemoryOpsStore.create(),
      });
      const client = {
        query: async ({ query }: { query: string }) => ({
          data: query.includes("system.parts")
            ? [{ table: "event_log", total_rows: "7", total_bytes: "64", parts_count: "1" }]
            : [],
        }),
      } as StorageStatsClickHouseClient;
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [{ target: "shared", client }],
        readings,
        collectBackups: false,
        logger: createTestLogger().logger,
      });
      const { process } = built(() => service.collect());

      await deliver(process, NOW);

      expect(await readings.findAll()).toEqual([
        {
          instance: "shared",
          tables: [{ table: "event_log", rows: 7, bytes: 64, parts: 1 }],
          disks: [],
          backupStatuses: [],
        },
      ]);
    });
  });

  describe("when a measurement fails", () => {
    /** @scenario "A failed measurement waits for the next wake" */
    it("settles the intent and measures again on the next wake", async () => {
      const measure = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error("redis unavailable"))
        .mockResolvedValue(undefined);
      const { process } = built(measure);

      await expect(deliver(process, NOW)).resolves.toBeUndefined();
      await deliver(process, NOW + 15_000);

      expect(measure).toHaveBeenCalledTimes(2);
    });
  });
});
