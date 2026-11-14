import type { ReaderReadStatement } from "@langwatch/clickhouse-client/builder";
import { describe, expect, it, vi } from "vitest";

import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

const query = {
  tenantId: "project_1",
  evaluatorIds: ["monitor_1"],
  previousStartMs: 1,
  currentStartMs: 2,
  endMs: 3,
  timeZone: "UTC",
};

describe("ClickHouseMonitorPerformanceRepository", () => {
  /** @scenario "Monitor performance uses the same capability" */
  it("keeps the trace-anchored analytics envelope and query safety settings", async () => {
    const statements: ReaderReadStatement[] = [];
    const read = vi.fn(async ({ statement }: { statement: ReaderReadStatement }) => {
      statements.push(statement);
      return {
        rows: [
          {
            EvaluatorId: "monitor_1",
            Period: "current",
            Day: "2026-08-25",
            ScoreSum: 1.5,
            ScoreCount: "2",
            PassSum: "0",
            PassCount: "0",
          },
        ],
      };
    });
    const repository = ClickHouseMonitorPerformanceRepository.create({
      resolveQueryClient: async () => ({ read }) as never,
    });

    await expect(repository.findBuckets(query)).resolves.toEqual([
      {
        evaluatorId: "monitor_1",
        period: "current",
        day: "2026-08-25",
        scoreSum: 1.5,
        scoreCount: 2,
        passSum: 0,
        passCount: 0,
      },
    ]);

    const [statement] = statements;
    expect(statement).toMatchObject({ identity: "reader", kind: "tenant", tenantId: "project_1" });
    expect(statement?.settings).toMatchObject({ SQL_langwatch_tenant_ids: "project_1" });
    expect(statement?.sql).toContain(
      "SETTINGS max_bytes_before_external_group_by = '500000000', max_execution_time = 15",
    );
    expect(statement?.sql).toContain("FROM trace_summaries");
    expect(statement?.sql).toContain("ScheduledAt >=");
    // Both table reads carry the tenant predicate, and the join matches on the tenant too.
    expect(statement?.sql.match(/TenantId = \{/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("does not resolve ClickHouse for an empty monitor set", async () => {
    const resolveQueryClient = vi.fn();
    const repository = ClickHouseMonitorPerformanceRepository.create({ resolveQueryClient });

    await expect(repository.findBuckets({ ...query, evaluatorIds: [] })).resolves.toEqual([]);
    expect(resolveQueryClient).not.toHaveBeenCalled();
  });
});
