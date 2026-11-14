/**
 * ADR-202: the usage counts are built reads, one single-tenant reader statement per project with
 * its tenant setting, FINAL as the report always read.
 */
import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it } from "vitest";

import { ClickHouseInstantEvalJudgmentsRepository } from "../clickhouse.instant-eval-judgments.repository.ts";
import { ClickHouseInstantEvalRunRepository } from "../clickhouse.instant-eval-run.repository.ts";

function recordingClient() {
  const statements: ReaderReadStatement[] = [];
  const client = {
    read: async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return { rows: [{ Total: "2", Counted: "2", FirstMs: "1000" }] };
    },
    insert: async () => undefined,
  };
  return { statements, resolveClient: async () => client as never };
}

describe("given the usage counts of two projects", () => {
  describe("when runs and judgments are counted", () => {
    it("sends one single-tenant reader read per project, each with its tenant setting", async () => {
      const { statements, resolveClient } = recordingClient();
      const runs = ClickHouseInstantEvalRunRepository.create({ resolveClient });
      const judgments = ClickHouseInstantEvalJudgmentsRepository.create({ resolveClient });

      await expect(
        runs.countUsage({ projectIds: ["project-a", "project-b"], since: 500 }),
      ).resolves.toEqual({ runs: 4, firstRunAt: 1000 });
      await expect(
        judgments.countUsage({ projectIds: ["project-a", "project-b"], since: 500 }),
      ).resolves.toBe(4);

      expect(statements).toHaveLength(6);
      for (const statement of statements) {
        expect(statement).toMatchObject({ identity: "reader", kind: "tenant" });
        expect(statement.settings).toMatchObject({ SQL_langwatch_tenant_ids: statement.tenantId });
        expect(statement.sql).toContain("WHERE TenantId = {tenantId:String}");
      }
      expect(new Set(statements.map((statement) => statement.tenantId))).toEqual(
        new Set(["project-a", "project-b"]),
      );
      const windowed = statements.filter((statement) => statement.sql.includes(" FINAL"));
      expect(windowed).toHaveLength(4);
      for (const statement of windowed) {
        expect(statement.sql).toMatch(/CreatedAt >= fromUnixTimestamp64Milli\(\{v\d+:Int64\}\)/);
      }
    });
  });
});
