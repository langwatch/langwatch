/**
 * These gauges are the only producer for table-size, disk and backup
 * alerts. Two failure modes: reporting a dropped table, and letting one
 * bad endpoint affect others. Spec: specs/ops/worker-operational-loops.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryStorageFootprintRepository } from "../../repositories/memory/memory.storage-footprint.repository.ts";
import { MemoryStorageStatsReadingsRepository } from "../../repositories/memory/memory.storage-stats-readings.repository.ts";
import { StorageStatsCollectionService } from "../storage-stats-collection.service.ts";

function sharedReadings() {
  return MemoryStorageStatsReadingsRepository.create({ store: MemoryOpsStore.create() });
}

async function tablesOf(readings: MemoryStorageStatsReadingsRepository): Promise<string[]> {
  return (await readings.findAll()).flatMap((reading) =>
    reading.tables.map((table) => `${reading.instance} ${table.table}`),
  );
}

function endpointHolding(script: {
  tables?: MemoryStorageFootprintRepository["tables"];
  disks?: MemoryStorageFootprintRepository["disks"];
  refuse?: boolean;
}): MemoryStorageFootprintRepository {
  const storage = MemoryStorageFootprintRepository.create();
  storage.tables = script.tables ?? [];
  storage.disks = script.disks ?? [];
  if (script.refuse) storage.refusals.tables = () => new Error("connection refused");
  return storage;
}

function tableRow(table: string, rows: number) {
  return { table, rows, bytes: 2048, parts: 3 };
}

describe("given an endpoint holding rows in monitored tables", () => {
  describe("when the collection ticks", () => {
    /** @scenario "Every monitored table is reported with its endpoint" */
    it("records each table's rows, bytes and parts against that endpoint", async () => {
      const readings = sharedReadings();
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [
          {
            target: "shared",
            storage: endpointHolding({
              tables: [tableRow("stored_spans", 10), tableRow("trace_summaries", 4)],
              disks: [{ disk: "default", totalBytes: 100, freeBytes: 40, usedBytes: 60 }],
            }),
          },
        ],
        readings,
        collectBackups: false,
        logger: createTestLogger().logger,
      });

      await service.collect();

      const [reading] = await readings.findAll();
      expect(reading?.tables).toEqual([
        { table: "stored_spans", rows: 10, bytes: 2048, parts: 3 },
        { table: "trace_summaries", rows: 4, bytes: 2048, parts: 3 },
      ]);
      expect(reading?.disks.map((disk) => `${reading.instance} ${disk.disk}`)).toEqual([
        "shared default",
      ]);
    });
  });

  describe("when the next tick no longer finds a table", () => {
    /** @scenario "A table that has dropped to nothing stops being reported" */
    it("stops reporting it rather than holding it at its last size", async () => {
      const readings = sharedReadings();
      const storage = endpointHolding({
        tables: [tableRow("stored_spans", 10), tableRow("events", 7)],
      });
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [{ target: "shared", storage }],
        readings,
        collectBackups: false,
        logger: createTestLogger().logger,
      });

      await service.collect();
      storage.tables = [tableRow("stored_spans", 10)];
      await service.collect();

      expect(await tablesOf(readings)).toEqual(["shared stored_spans"]);
    });
  });
});

describe("given two configured endpoints, one of which refuses the read", () => {
  describe("when the collection ticks", () => {
    /** @scenario "An unreachable endpoint does not take the others with it" */
    it("still reports the reachable endpoint", async () => {
      const readings = sharedReadings();
      const service = StorageStatsCollectionService.create({
        resolveInstances: async () => [
          { target: "private-acme", storage: endpointHolding({ refuse: true }) },
          { target: "shared", storage: endpointHolding({ tables: [tableRow("event_log", 1)] }) },
        ],
        readings,
        collectBackups: false,
        logger: createTestLogger().logger,
      });

      await service.collect();

      expect(await tablesOf(readings)).toEqual(["shared event_log"]);
    });
  });
});
