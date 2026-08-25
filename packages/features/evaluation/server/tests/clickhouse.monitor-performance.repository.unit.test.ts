import { describe, expect, it, vi } from "vitest";
import { ClickHouseMonitorPerformanceRepository } from "../src/repositories/clickhouse/clickhouse.monitor-performance.repository";
import type { EvaluationClickHouseClient } from "../src/ports/evaluation.port";

describe("ClickHouseMonitorPerformanceRepository", () => {
  it("keeps the trace-anchored analytics envelope and query safety settings", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const query = vi.fn(async (request: Record<string, unknown>) => {
      requests.push(request);
      return {
        json: async () => [
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
    const client = { query } as unknown as EvaluationClickHouseClient;
    const repository = ClickHouseMonitorPerformanceRepository.create({
      resolveClient: async () => client,
    });

    await expect(
      repository.findBuckets({
        tenantId: "project_1",
        evaluatorIds: ["monitor_1"],
        previousStartMs: 1,
        currentStartMs: 2,
        endMs: 3,
        timeZone: "UTC",
      }),
    ).resolves.toEqual([
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

    const request = requests[0]!;
    expect(request.query).toContain("FROM trace_summaries");
    expect(request.query).toContain("ScheduledAt >=");
    expect(request.clickhouse_settings).toEqual({
      max_bytes_before_external_group_by: 500_000_000,
      max_execution_time: 15,
    });
  });

  it("does not resolve ClickHouse for an empty monitor set", async () => {
    const resolveClient = vi.fn();
    const repository = ClickHouseMonitorPerformanceRepository.create({
      resolveClient,
    });

    await expect(
      repository.findBuckets({
        tenantId: "project_1",
        evaluatorIds: [],
        previousStartMs: 1,
        currentStartMs: 2,
        endMs: 3,
        timeZone: "UTC",
      }),
    ).resolves.toEqual([]);
    expect(resolveClient).not.toHaveBeenCalled();
  });
});
