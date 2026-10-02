/** Spec: modules/ops/specs/storage-stats.feature */
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryStorageFootprintRepository } from "../../repositories/memory/memory.storage-footprint.repository.ts";
import { MemoryStorageStatsReadingsRepository } from "../../repositories/memory/memory.storage-stats-readings.repository.ts";
import { StorageStatsCollectionService } from "../storage-stats-collection.service.ts";
import { StorageStatsGaugesService } from "../storage-stats-gauges.service.ts";

let provider = createRecordingMeterProvider();

beforeEach(() => {
  provider = createRecordingMeterProvider();
  provider.install();
});
afterEach(() => provider.uninstall());

function clickhouse(rows: number): MemoryStorageFootprintRepository {
  const storage = MemoryStorageFootprintRepository.create();
  storage.tables = [{ table: "stored_spans", rows, bytes: 2048, parts: 3 }];
  return storage;
}

describe("given an api and a worker reading the same shared readings", () => {
  describe("when the worker running the storage-stats process measures", () => {
    /** @scenario "Every process exports the reading the one measurement saved" */
    it("both processes export that reading", async () => {
      const shared = MemoryStorageStatsReadingsRepository.create({
        store: MemoryOpsStore.create(),
      });
      StorageStatsGaugesService.create({ readings: shared }).publish();
      StorageStatsGaugesService.create({ readings: shared }).publish();
      const measuring = StorageStatsCollectionService.create({
        resolveInstances: async () => [{ target: "shared", storage: clickhouse(10) }],
        readings: shared,
        collectBackups: false,
        logger: createTestLogger().logger,
      });

      await measuring.collect();
      await provider.collect();

      expect(
        provider.valuesOf("clickhouse_table_rows", { instance: "shared", table: "stored_spans" }),
      ).toEqual([10, 10]);
    });
  });

  describe("when a later measurement reads a new size", () => {
    /** @scenario "Every process exports the reading the one measurement saved" */
    it("each process exports the new size on its next export", async () => {
      const shared = MemoryStorageStatsReadingsRepository.create({
        store: MemoryOpsStore.create(),
      });
      StorageStatsGaugesService.create({ readings: shared }).publish();
      let rows = 10;
      const measuring = StorageStatsCollectionService.create({
        resolveInstances: async () => [{ target: "shared", storage: clickhouse(rows) }],
        readings: shared,
        collectBackups: false,
        logger: createTestLogger().logger,
      });
      await measuring.collect();
      rows = 25;

      await measuring.collect();
      await provider.collect();

      expect(provider.valuesOf("clickhouse_table_rows", { table: "stored_spans" })).toEqual([25]);
    });
  });
});
