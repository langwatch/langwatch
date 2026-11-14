/** Spec: specs/ops/worker-operational-loops.feature */
import { type ClickHouseQueryClient, TENANT_IDS_SETTING } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseStorageFootprintRepository } from "../clickhouse.storage-footprint.repository.ts";

type Sent = Parameters<ClickHouseQueryClient["read"]>[0];

/** The routed client's read, answering every statement with `rows` and recording it. */
function repoAnswering(rows: Record<string, string>[], backupLogPresent = "1") {
  const sent: Sent[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    read: async (built: Sent) => {
      sent.push(built);
      if (built.table === "system.tables") return { rows: [{ present: backupLogPresent }] };
      return { rows };
    },
  });
  return { repo: ClickHouseStorageFootprintRepository.create({ clickhouse }), sent };
}

/** Each footprint read is all-tenants, on the system identity, with no tenant setting. */
function expectSystemRead(built: Sent | undefined) {
  expect(built?.statement).toMatchObject({ identity: "system", kind: "allTenants" });
  expect(built?.statement.settings ?? {}).not.toHaveProperty(TENANT_IDS_SETTING);
  expect(built?.tenantId).toBeUndefined();
}

describe("given an endpoint's system tables", () => {
  describe("when the monitored tables are read", () => {
    it("asks system.parts on the system identity for only the named tables, and reads the sums as numbers", async () => {
      const { repo, sent } = repoAnswering([
        { table: "stored_spans", total_rows: "10", total_bytes: "2048", parts_count: "3" },
      ]);

      const tables = await repo.findTables({ tables: ["stored_spans", "events"] });

      expect(tables).toEqual([{ table: "stored_spans", rows: 10, bytes: 2048, parts: 3 }]);
      expect(sent[0]?.table).toBe("system.parts");
      expect(sent[0]?.statement.sql).toContain("FROM system.parts");
      expect(Object.values(sent[0]?.statement.params ?? {})).toContainEqual([
        "stored_spans",
        "events",
      ]);
      expectSystemRead(sent[0]);
    });
  });

  describe("when the disks are read", () => {
    it("asks system.disks on the system identity and reads the capacities as numbers", async () => {
      const { repo, sent } = repoAnswering([
        { name: "default", total_space: "100", free_space: "40", used_space: "60" },
      ]);

      expect(await repo.findDisks()).toEqual([
        { disk: "default", totalBytes: 100, usedBytes: 60, freeBytes: 40 },
      ]);
      expect(sent[0]?.table).toBe("system.disks");
      expectSystemRead(sent[0]);
    });
  });

  describe("when the backup log is read", () => {
    it("reads each status's count and the last success as ClickHouse returned it", async () => {
      const { repo, sent } = repoAnswering([
        {
          status: "BACKUP_CREATED",
          cnt: "2",
          last_success_time: "2026-10-01 12:00:00",
          last_success_size: "4096",
        },
      ]);

      expect(await repo.findBackupStatuses()).toEqual([
        {
          status: "BACKUP_CREATED",
          count: 2,
          lastSuccessTime: "2026-10-01 12:00:00",
          lastSuccessSizeBytes: 4096,
        },
      ]);
      expect(sent[0]?.table).toBe("system.tables");
      expect(sent[1]?.statement.sql).toContain("FROM system.backup_log");
      expectSystemRead(sent[0]);
      expectSystemRead(sent[1]);
    });

    it("skips the query, so nothing errors, on a server without the table", async () => {
      const { repo, sent } = repoAnswering([], "0");

      expect(await repo.findBackupStatuses()).toEqual([]);
      expect(sent.map(({ statement }) => statement.sql).join()).not.toContain(
        "FROM system.backup_log",
      );
    });
  });
});
