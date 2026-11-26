import { describe, expect, it, vi } from "vitest";

import type {
  EvaluationClickHouseClient,
  EvaluationClickHouseQuery,
} from "../clickhouse.evaluation-session.store.ts";
import { ClickHouseMonitorPerformanceRepository } from "../monitor-performance.repository.ts";

describe("ClickHouseMonitorPerformanceRepository", () => {
  /** @scenario "Monitor performance uses the same capability" */
  it("keeps the trace-anchored analytics envelope and query safety settings", async () => {
    const requests: Record<string, unknown>[] = [];
    const query = vi.fn(async (request: EvaluationClickHouseQuery) => {
      requests.push(request);
      return {
        json: async <T>() => [
          {
            EvaluatorId: "monitor_1",
            Period: "current",
            Day: "2026-08-25",
            ScoreSum: 1.5,
            ScoreCount: "2",
            PassSum: "0",
            PassCount: "0",
            LabelCounts: [
              ["", "resolved", "__proto__"],
              ["2", "1", "3"],
            ],
          } as T,
        ],
      };
    });
    const client: EvaluationClickHouseClient = {
      insert: async () => undefined,
      query,
    };
    const repository = ClickHouseMonitorPerformanceRepository.create({
      resolveClient: async () => client,
    });

    const buckets = await repository.findBuckets({
      tenantId: "project_1",
      evaluatorIds: ["monitor_1"],
      previousStartMs: 1,
      currentStartMs: 2,
      endMs: 3,
      timeZone: "UTC",
    });
    const { labelCounts, ...totals } = buckets[0]!;

    expect(buckets).toHaveLength(1);
    expect(totals).toEqual({
      evaluatorId: "monitor_1",
      period: "current",
      day: "2026-08-25",
      scoreSum: 1.5,
      scoreCount: 2,
      passSum: 0,
      passCount: 0,
    });
    // A label named "__proto__" stays a label, not the record's prototype.
    expect(Object.entries(labelCounts)).toEqual([
      ["resolved", 1],
      ["__proto__", 3],
    ]);

    const request = requests[0]!;
    expect(request.query).toContain("FROM trace_summaries");
    expect(request.query).toContain("ScheduledAt >=");
    expect(request.clickhouse_settings).toEqual({
      max_bytes_before_external_group_by: "500000000",
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
