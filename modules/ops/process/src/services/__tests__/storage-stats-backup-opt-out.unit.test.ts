/**
 * Backup collection is opt-out: the deployment's own spelling decides, and a deployment that says
 * nothing keeps collecting. Spec: specs/ops/clickhouse-backup-metrics.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryStorageFootprintRepository } from "../../repositories/memory/memory.storage-footprint.repository.ts";
import { MemoryStorageStatsReadingsRepository } from "../../repositories/memory/memory.storage-stats-readings.repository.ts";
import { StorageStatsCollectionService } from "../storage-stats-collection.service.ts";

const WARN = 40;

/** A collector with the flag the deployment config resolves to (see ops.config.unit.test.ts). */
function collectorFor({
  collectBackups,
  storage,
}: {
  collectBackups: boolean;
  storage: MemoryStorageFootprintRepository;
}) {
  const { logger, lines } = createTestLogger();
  const readings = MemoryStorageStatsReadingsRepository.create({ store: MemoryOpsStore.create() });
  const collector = StorageStatsCollectionService.create({
    resolveInstances: async () => [{ target: "shared", storage }],
    readings,
    collectBackups,
    logger,
  });
  return { collector, readings, lines };
}

function endpointWithABackup(): MemoryStorageFootprintRepository {
  const storage = MemoryStorageFootprintRepository.create();
  storage.tables = [{ table: "stored_spans", rows: 10, bytes: 2048, parts: 3 }];
  storage.backupStatuses = [
    {
      status: "BACKUP_CREATED",
      count: 2,
      lastSuccessTime: "2026-10-05 03:00:00",
      lastSuccessSizeBytes: 4096,
    },
  ];
  return storage;
}

describe("given the deployment's backup metrics setting", () => {
  describe("when CLICKHOUSE_BACKUP_METRICS_ENABLED is not set", () => {
    /** @scenario "a deployment that says nothing keeps collecting backup status" */
    it("collects backup status from the backup log", async () => {
      const { collector, readings } = collectorFor({
        collectBackups: true,
        storage: endpointWithABackup(),
      });

      await collector.collect();

      const [reading] = await readings.findAll();
      expect(reading?.backupStatuses).toEqual([{ status: "BACKUP_CREATED", count: 2 }]);
      expect(reading?.lastBackup?.sizeBytes).toBe(4096);
    });
  });

  describe("when collection is enabled for the deployment", () => {
    /** @scenario "a deployment with backups collects backup status" */
    it("collects backup status from the backup log", async () => {
      const { collector, readings } = collectorFor({
        collectBackups: true,
        storage: endpointWithABackup(),
      });

      await collector.collect();

      const [reading] = await readings.findAll();
      expect(reading?.backupStatuses).toEqual([{ status: "BACKUP_CREATED", count: 2 }]);
    });
  });

  describe("when collection is explicitly disabled", () => {
    /** @scenario "a deployment without backups opts out of the backup log query" */
    it("never queries the backup log and still collects table storage", async () => {
      const storage = endpointWithABackup();
      storage.refusals.backups = () => new Error("the backup log must not be read");
      const { collector, readings, lines } = collectorFor({
        collectBackups: false,
        storage,
      });

      await collector.collect();

      const [reading] = await readings.findAll();
      expect(reading?.backupStatuses).toEqual([]);
      expect(reading?.tables.map((table) => table.table)).toEqual(["stored_spans"]);
      expect(lines.filter((line) => line.level >= WARN)).toEqual([]);
    });
  });

  describe("when the value is unparseable", () => {
    /** @scenario "an unrecognised value is treated as enabled" */
    it("collects backup status from the backup log", async () => {
      const { collector, readings } = collectorFor({
        collectBackups: true,
        storage: endpointWithABackup(),
      });

      await collector.collect();

      const [reading] = await readings.findAll();
      expect(reading?.backupStatuses).toEqual([{ status: "BACKUP_CREATED", count: 2 }]);
    });
  });
});

describe("given a backup log that fails and then recovers", () => {
  describe("when the collector ticks through the streak", () => {
    /** @scenario "transient backup-log failure warns once until recovery" */
    it("warns once for the streak and logs the recovery once", async () => {
      const storage = endpointWithABackup();
      const { collector, lines } = collectorFor({ collectBackups: true, storage });
      storage.refusals.backups = () => new Error("connection refused");

      await collector.collect();
      await collector.collect();
      delete storage.refusals.backups;
      await collector.collect();
      await collector.collect();

      expect(lines.filter((line) => line.level === WARN)).toHaveLength(1);
      expect(
        lines.filter((line) => String(line.msg).includes("backup stats collection recovered")),
      ).toHaveLength(1);
    });
  });
});
