/** Spec: specs/ops/worker-operational-loops.feature */
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { ClickHouseStorageFootprintRepository } from "../clickhouse.storage-footprint.repository.ts";

/** The routed member, answering every statement with `rows` and recording what it was asked. */
function repoAnswering(rows: Record<string, string>[]) {
  const statements: QueryRequest[] = [];
  const clickhouse = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      statements.push(request);
      return { rows };
    },
  });
  return { repo: ClickHouseStorageFootprintRepository.create({ clickhouse }), statements };
}

describe("given an endpoint's system tables", () => {
  describe("when the monitored tables are read", () => {
    it("asks only for the named tables, unscoped, and reads the sums as numbers", async () => {
      const { repo, statements } = repoAnswering([
        { table: "stored_spans", total_rows: "10", total_bytes: "2048", parts_count: "3" },
      ]);

      const tables = await repo.findTables({ tables: ["stored_spans", "events"] });

      expect(tables).toEqual([{ table: "stored_spans", rows: 10, bytes: 2048, parts: 3 }]);
      expect(statements[0]?.sql).toContain("FROM system.parts");
      expect(statements[0]?.params).toEqual({ tables: ["stored_spans", "events"] });
      expect(statements[0]?.tenantId).toBe("");
      expect(statements[0]?.unscoped?.reason).toContain("system.parts");
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
      expect(statements[0]?.sql).toContain("FROM system.backup_log");
    });
  });
});
