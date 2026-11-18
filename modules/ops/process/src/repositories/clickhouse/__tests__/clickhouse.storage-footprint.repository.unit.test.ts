/** Spec: specs/ops/worker-operational-loops.feature */
import { type ClickHouseQueryClient, TENANT_IDS_SETTING } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseStorageFootprintRepository } from "../clickhouse.storage-footprint.repository.ts";

type Sent = Parameters<ClickHouseQueryClient["read"]>[0];

/** The routed client, answering every built read with `rows`, recording each. */
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

/** A repository whose reads of `table` on every replica fail with `code`; local reads answer. */
function repoRefusingEveryReplica({ table, code }: { table: string; code: string }) {
  const sent: Sent[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    read: async (built: Sent) => {
      sent.push(built);
      if (built.table === table && readsEveryReplica(built)) {
        throw Object.assign(new Error(`refused with ${code}`), { code });
      }
      if (built.table === "system.tables") return { rows: [{ present: "1" }] };
      return { rows: [] };
    },
  });
  return { repo: ClickHouseStorageFootprintRepository.create({ clickhouse }), sent };
}

const readsEveryReplica = (built: Sent | undefined) =>
  built?.statement.sql.includes("clusterAllReplicas(") ?? false;

/** The read reaches `table` on the local node only, with no replica setting. */
function expectLocalRead(built: Sent | undefined, table: string) {
  expect(built?.statement.sql).toContain(`FROM ${table}`);
  expect(readsEveryReplica(built)).toBe(false);
  expect(built?.statement.sql).not.toContain("skip_unavailable_shards");
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
      expect(sent[1]?.table).toBe("system.backup_log");
      expectLocalRead(sent[1], "system.backup_log");
      expectSystemRead(sent[1]);
    });

    /** @scenario "A named cluster reads every replica's backup history" */
    it("reads every replica's log when a cluster is named, so another replica's backup counts", async () => {
      const { repo, sent } = repoAnswering([]);

      await repo.findBackupStatuses({ cluster: "default" });

      expect(sent.map((built) => built.table)).toEqual(["system.tables", "system.backup_log"]);
      expect(sent[0]?.statement.sql).toMatch(
        /clusterAllReplicas\(\{v\d+:Identifier\}, system\.tables\)/,
      );
      expect(sent[1]?.statement.sql).toMatch(
        /clusterAllReplicas\(\{v\d+:Identifier\}, system\.backup_log\)/,
      );
      for (const built of sent) {
        expect(Object.values(built.statement.params)).toContain("default");
        expect(built.statement.sql).not.toContain("default");
        expect(built.statement.sql).toContain("SETTINGS skip_unavailable_shards = 1");
        expectSystemRead(built);
      }
    });

    /** @scenario "A cluster the server does not know falls back to the local node" */
    it.each([
      ["the table probe", "system.tables"],
      ["the backup read", "system.backup_log"],
    ])("falls back to the local node when the cluster is unknown at %s", async (_label, table) => {
      const { repo, sent } = repoRefusingEveryReplica({ table, code: "170" });

      await expect(repo.findBackupStatuses({ cluster: "default" })).resolves.toEqual([]);

      expect(sent.at(-1)?.table).toBe("system.backup_log");
      expectLocalRead(sent.at(-1), "system.backup_log");
    });

    /** @scenario "Any other cluster-wide failure is reported, not hidden" */
    it.each([
      ["a timeout at the backup read", "system.backup_log", "159"],
      ["a missing table at the backup read", "system.backup_log", "60"],
      ["missing rights at the table probe", "system.tables", "497"],
      ["missing rights at the backup read", "system.backup_log", "497"],
    ])("throws %s instead of reading the local node", async (_label, table, code) => {
      const { repo, sent } = repoRefusingEveryReplica({ table, code });

      await expect(repo.findBackupStatuses({ cluster: "default" })).rejects.toThrow(code);
      expect(sent.every(readsEveryReplica)).toBe(true);
    });

    /** @scenario "A cluster name that is not a plain identifier reads the local node" */
    it("reads the local log with no cluster, or one that is not a plain name", async () => {
      for (const cluster of [undefined, "", "x'); DROP TABLE t; --"]) {
        const { repo, sent } = repoAnswering([]);

        await repo.findBackupStatuses({ cluster });

        expect(sent.map((built) => built.table)).toEqual(["system.tables", "system.backup_log"]);
        expectLocalRead(sent[0], "system.tables");
        expectLocalRead(sent[1], "system.backup_log");
      }
    });

    it("skips the query, so nothing errors, on a server without the table", async () => {
      const { repo, sent } = repoAnswering([], "0");

      expect(await repo.findBackupStatuses()).toEqual([]);
      expect(sent.map((built) => built.table)).toEqual(["system.tables"]);
    });
  });
});
