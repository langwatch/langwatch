/** Spec: specs/ops/worker-operational-loops.feature */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseStorageFootprintRepository } from "../clickhouse.storage-footprint.repository.ts";

/** The routed member, answering every statement with `rows` and recording what it was asked. */
function repoAnswering(rows: Record<string, string>[], backupLogPresent = "1") {
  const statements: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      statements.push(request);
      if (request.sql.includes("system.tables")) return { rows: [{ present: backupLogPresent }] };
      return { rows };
    },
  });
  return { repo: ClickHouseStorageFootprintRepository.create({ clickhouse }), statements };
}

describe("given an endpoint's system tables", () => {
  describe("when the monitored tables are read", () => {
    it("asks only for the named tables, skipping the tenant check, and reads the sums as numbers", async () => {
      const { repo, statements } = repoAnswering([
        { table: "stored_spans", total_rows: "10", total_bytes: "2048", parts_count: "3" },
      ]);

      const tables = await repo.findTables({ tables: ["stored_spans", "events"] });

      expect(tables).toEqual([{ table: "stored_spans", rows: 10, bytes: 2048, parts: 3 }]);
      expect(statements[0]?.sql).toContain("FROM system.parts");
      expect(statements[0]?.params).toEqual({ tables: ["stored_spans", "events"] });
      expect(statements[0]?.tenantId).toBe("");
      expect(statements[0]?.SKIP_TENANT_CHECK).toBe(true);
    });
  });

  describe("when the backup log is read", () => {
    it("reads each status's count and the last success as ClickHouse returned it", async () => {
      const { repo, statements } = repoAnswering([
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
      expect(statements[1]?.sql).toContain("FROM system.backup_log");
    });

    /** @scenario "A named cluster reads every replica's backup history" */
    it("reads every replica's log when a cluster is named, so another replica's backup counts", async () => {
      const { repo, statements } = repoAnswering([]);

      await repo.findBackupStatuses({ cluster: "default" });

      expect(statements[1]?.sql).toContain("clusterAllReplicas('default', system.backup_log)");
      expect(statements[1]?.sql).toContain("skip_unavailable_shards = 1");
      expect(statements[0]?.sql).toContain("clusterAllReplicas('default', system.tables)");
    });

    /** @scenario "A cluster the server does not know falls back to the local node" */
    it.each([
      ["the table probe", "system.tables"],
      ["the backup read", "system.backup_log"],
    ])("falls back to the local node when the cluster is unknown at %s", async (_label, table) => {
      const statements: QueryRequest[] = [];
      const clickhouse = clickHouseQueryClientDouble({
        query: async (request: QueryRequest) => {
          statements.push(request);
          if (request.sql.includes(`clusterAllReplicas('default', ${table})`)) {
            throw Object.assign(new Error("Requested cluster 'default' not found"), {
              code: "170",
            });
          }
          if (request.sql.includes("system.tables")) return { rows: [{ present: "1" }] };
          return { rows: [] };
        },
      });
      const repo = ClickHouseStorageFootprintRepository.create({ clickhouse });

      await expect(repo.findBackupStatuses({ cluster: "default" })).resolves.toEqual([]);

      expect(statements.at(-1)?.sql).toContain("FROM system.backup_log");
      expect(statements.at(-1)?.sql).not.toContain("clusterAllReplicas");
    });

    /** @scenario "Any other cluster-wide failure is reported, not hidden" */
    it.each([
      ["a timeout at the backup read", "system.backup_log", "159"],
      ["a missing table at the backup read", "system.backup_log", "60"],
      ["missing rights at the table probe", "system.tables", "497"],
      ["missing rights at the backup read", "system.backup_log", "497"],
    ])("throws %s instead of reading the local node", async (_label, table, code) => {
      const statements: QueryRequest[] = [];
      const clickhouse = clickHouseQueryClientDouble({
        query: async (request: QueryRequest) => {
          statements.push(request);
          if (request.sql.includes(`clusterAllReplicas('default', ${table})`)) {
            throw Object.assign(new Error(`refused with ${code}`), { code });
          }
          if (request.sql.includes("system.tables")) return { rows: [{ present: "1" }] };
          return { rows: [] };
        },
      });
      const repo = ClickHouseStorageFootprintRepository.create({ clickhouse });

      await expect(repo.findBackupStatuses({ cluster: "default" })).rejects.toThrow(code);
      expect(statements.every(({ sql }) => sql.includes("clusterAllReplicas"))).toBe(true);
    });

    /** @scenario "A cluster name that is not a plain identifier reads the local node" */
    it("reads the local log with no cluster, or one that is not a plain name", async () => {
      for (const cluster of [undefined, "", "x'); DROP TABLE t; --"]) {
        const { repo, statements } = repoAnswering([]);

        await repo.findBackupStatuses({ cluster });

        expect(statements[1]?.sql).toContain("FROM system.backup_log");
        expect(statements[1]?.sql).not.toContain("clusterAllReplicas");
      }
    });

    it("skips the query, so nothing errors, on a server without the table", async () => {
      const { repo, statements } = repoAnswering([], "0");

      expect(await repo.findBackupStatuses()).toEqual([]);
      expect(statements.map(({ sql }) => sql).join()).not.toContain("FROM system.backup_log");
    });
  });
});
