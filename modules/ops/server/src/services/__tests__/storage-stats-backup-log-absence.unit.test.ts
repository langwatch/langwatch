/**
 * Backup collection is opt-out, so every install checks it - even those
 * without a backup_log table. Don't warn repeatedly for this expected
 * absence. Spec: specs/ops/clickhouse-backup-metrics.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerInfo = vi.hoisted(() => vi.fn());
const loggerWarn = vi.hoisted(() => vi.fn());

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: loggerInfo,
    warn: loggerWarn,
    error: vi.fn(),
  }),
}));

import type { StorageStatsMetrics } from "../../app/ops.app.ts";
import {
  StorageStatsCollectionService,
  type StorageStatsClickHouseClient,
} from "../storage-stats-collection.service.ts";

class SilentMetrics implements StorageStatsMetrics {
  beginTick(): void {}
  recordTable(): void {}
  recordDisk(): void {}
  recordBackupStatus(): void {}
  recordLastBackup(): void {}
}

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
      return { json: async () => ({ data: [] }) };
    },
  } as StorageStatsClickHouseClient;
}

function collectorOver(client: StorageStatsClickHouseClient): StorageStatsCollectionService {
  return StorageStatsCollectionService.create({
    resolveInstances: async () => [{ target: "shared", client }],
    metrics: new SilentMetrics(),
    collectBackups: true,
  });
}

beforeEach(() => {
  loggerInfo.mockClear();
  loggerWarn.mockClear();
});

describe("given a ClickHouse that has never taken a backup", () => {
  describe("when the collector ticks repeatedly", () => {
    /** @scenario "an instance with no backup log names the absence once at info" */
    it("names the absent table once at info and never warns", async () => {
      const collector = collectorOver(clientRefusingBackupLog(unknownTable));

      await collector.collect();
      await collector.collect();
      await collector.collect();

      expect(loggerWarn).not.toHaveBeenCalled();
      expect(loggerInfo).toHaveBeenCalledTimes(1);
      expect(loggerInfo.mock.calls[0]?.[1]).toContain("system.backup_log");
    });
  });
});

describe("given a backup log that fails for any other reason", () => {
  describe("when the collector ticks repeatedly", () => {
    /** @scenario "transient backup-log failure warns once until recovery" */
    it("still warns once for the failure streak", async () => {
      const collector = collectorOver(
        clientRefusingBackupLog(() => new Error("connection refused")),
      );

      await collector.collect();
      await collector.collect();

      expect(loggerWarn).toHaveBeenCalledTimes(1);
    });
  });
});
