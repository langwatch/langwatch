/**
 * Backup collection is opt-out, so every install checks it - even those
 * without a backup_log table. Don't warn repeatedly for this expected
 * absence. Spec: specs/ops/clickhouse-backup-metrics.feature
 */
import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { MemoryOpsStore } from "../../repositories/memory/memory.ops.store.ts";
import { MemoryStorageStatsReadingsRepository } from "../../repositories/memory/memory.storage-stats-readings.repository.ts";
import {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
} from "../storage-stats-collection.service.ts";

const INFO = 30;
const WARN = 40;

/** ClickHouse's own refusal when the table the first backup would create is not there. */
function unknownTable(): Error & { code: string; type: string } {
  return Object.assign(new Error("Table system.backup_log does not exist. (UNKNOWN_TABLE)"), {
    code: "60",
    type: "UNKNOWN_TABLE",
  });
}

function clientRefusingBackupLog(failure: () => Error): StorageStatsClickHouseClient {
  return {
    query: async ({ query }) => {
      if (query.includes("system.backup_log")) throw failure();
      return { data: [] };
    },
  } as StorageStatsClickHouseClient;
}

function collectorOver(client: StorageStatsClickHouseClient) {
  const { logger, lines } = createTestLogger();
  const collector = StorageStatsCollectionService.create({
    resolveInstances: async () => [{ target: "shared", client }],
    readings: MemoryStorageStatsReadingsRepository.create({ store: MemoryOpsStore.create() }),
    collectBackups: true,
    logger,
  });
  return { collector, lines };
}

describe("given a ClickHouse that has never taken a backup", () => {
  describe("when the collector ticks repeatedly", () => {
    /** @scenario "an instance with no backup log names the absence once at info" */
    it("names the absent table once at info and never warns", async () => {
      const { collector, lines } = collectorOver(clientRefusingBackupLog(unknownTable));

      await collector.collect();
      await collector.collect();
      await collector.collect();

      const info = lines.filter((line) => line.level === INFO);
      expect(lines.filter((line) => line.level === WARN)).toEqual([]);
      expect(info).toHaveLength(1);
      expect(info[0]?.msg).toContain("system.backup_log");
    });
  });
});

describe("given a backup log that fails for any other reason", () => {
  describe("when the collector ticks repeatedly", () => {
    /** @scenario "transient backup-log failure warns once until recovery" */
    it("still warns once for the failure streak", async () => {
      const { collector, lines } = collectorOver(
        clientRefusingBackupLog(() => new Error("connection refused")),
      );

      await collector.collect();
      await collector.collect();

      expect(lines.filter((line) => line.level === WARN)).toHaveLength(1);
    });
  });
});
