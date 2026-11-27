/**
 * @vitest-environment node
 * The staff count of evaluator usage per type across every project, stated once and run
 * against the memory twin of the ClickHouse read over `evaluation_runs`.
 */
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { MemoryEvaluationRepositories } from "../memory/memory.evaluation.repositories.ts";
import type { MonitorPerformanceRepository } from "../monitor-performance.repository.ts";

const HOUR_MS = 60 * 60 * 1000;
const UNTIL = 1_800_000_000_000;
const SINCE = UNTIL - 24 * HOUR_MS;
const FIRST = "project-first";
const SECOND = "project-second";
const TYPE = "langevals/exact_match";

type StoredRun = { tenantId: string; data: EvaluationRunData };

type Backend = Readonly<{
  name: string;
  given: (runs: readonly StoredRun[]) => Promise<MonitorPerformanceRepository>;
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    given: async (runs) => {
      const repositories = MemoryEvaluationRepositories.create();
      for (const run of runs) await repositories.runs.upsert(run);
      return repositories.monitorPerformance;
    },
  },
];

let sequence = 0;

function run({
  tenantId,
  status,
  scheduledAt,
  error = null,
  evaluationId,
  updatedAt = scheduledAt,
  evaluatorType = TYPE,
}: {
  tenantId: string;
  status: EvaluationRunData["status"];
  scheduledAt: number;
  error?: string | null;
  evaluationId?: string;
  updatedAt?: number;
  evaluatorType?: string;
}): StoredRun {
  sequence += 1;
  return {
    tenantId,
    data: {
      evaluationId: evaluationId ?? `evaluation-${sequence}`,
      evaluatorId: `${tenantId}-monitor`,
      evaluatorType,
      evaluatorName: "Secret evaluator name",
      traceId: `trace-${sequence}`,
      isGuardrail: false,
      status,
      score: null,
      passed: null,
      label: null,
      details: null,
      inputs: null,
      error,
      errorDetails: null,
      createdAt: scheduledAt,
      updatedAt,
      LastEventOccurredAt: updatedAt,
      archivedAt: null,
      scheduledAt,
      startedAt: scheduledAt,
      completedAt: updatedAt,
      costId: null,
    },
  };
}

describe.each(backends)("given the $name monitor performance repository", ({ given }) => {
  describe("when evaluator usage is counted per type (findTypeUsageRows)", () => {
    it("counts each type's projects, runs, errors by code and skipped runs", async () => {
      const repository = await given([
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE + HOUR_MS }),
        run({
          tenantId: FIRST,
          status: "error",
          scheduledAt: SINCE + 2 * HOUR_MS,
          error: "Request timed out while judging 'the customer said their card is 4111'",
        }),
        run({ tenantId: FIRST, status: "skipped", scheduledAt: SINCE + 3 * HOUR_MS }),
        run({ tenantId: FIRST, status: "error", scheduledAt: SINCE - HOUR_MS }),
        run({
          tenantId: SECOND,
          status: "error",
          error: "rate limit",
          scheduledAt: SINCE + HOUR_MS,
        }),
        run({
          tenantId: SECOND,
          status: "error",
          error: "Service Unavailable (503)",
          evaluationId: "retried",
          scheduledAt: SINCE + 5 * HOUR_MS,
        }),
        run({
          tenantId: SECOND,
          status: "processed",
          evaluationId: "retried",
          scheduledAt: SINCE + 5 * HOUR_MS,
          updatedAt: SINCE + 6 * HOUR_MS,
        }),
      ]);

      const usage = await repository.findTypeUsageRows({ since: SINCE, until: UNTIL, limit: 10 });

      expect(usage).toEqual([
        {
          evaluatorType: TYPE,
          projects: 2,
          runs: 5,
          errors: 2,
          skipped: 1,
          errorsByCode: { rate_limited: 1, timeout: 1 },
        },
      ]);
      expect(JSON.stringify(usage)).not.toContain("4111");
      expect(JSON.stringify(usage)).not.toContain("Secret evaluator name");
    });

    it("counts a run scheduled exactly at since, never one at until", async () => {
      const repository = await given([
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE }),
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE - 1 }),
        run({ tenantId: FIRST, status: "processed", scheduledAt: UNTIL }),
      ]);

      await expect(
        repository.findTypeUsageRows({ since: SINCE, until: UNTIL, limit: 10 }),
      ).resolves.toEqual([
        { evaluatorType: TYPE, projects: 1, runs: 1, errors: 0, skipped: 0, errorsByCode: {} },
      ]);
    });

    it("answers no rows for an empty or inverted window", async () => {
      const repository = await given([
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE }),
      ]);

      await expect(
        repository.findTypeUsageRows({ since: SINCE, until: SINCE, limit: 10 }),
      ).resolves.toEqual([]);
      await expect(
        repository.findTypeUsageRows({ since: UNTIL, until: SINCE, limit: 10 }),
      ).resolves.toEqual([]);
    });

    it("keeps a plain error code, reads other text as other and ignores text on skipped runs", async () => {
      const repository = await given([
        run({ tenantId: FIRST, status: "error", scheduledAt: SINCE, error: "boom" }),
        run({ tenantId: FIRST, status: "error", scheduledAt: SINCE, error: "Something broke." }),
        run({ tenantId: FIRST, status: "error", scheduledAt: SINCE, error: null }),
        run({ tenantId: FIRST, status: "skipped", scheduledAt: SINCE, error: "rate limit" }),
      ]);

      await expect(
        repository.findTypeUsageRows({ since: SINCE, until: UNTIL, limit: 10 }),
      ).resolves.toEqual([
        {
          evaluatorType: TYPE,
          projects: 1,
          runs: 4,
          errors: 3,
          skipped: 1,
          errorsByCode: { boom: 1, other: 2 },
        },
      ]);
    });

    it("orders types by runs, then by type, and stops at the limit", async () => {
      const repository = await given([
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE, evaluatorType: "b/one" }),
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE, evaluatorType: "a/one" }),
        run({ tenantId: FIRST, status: "processed", scheduledAt: SINCE, evaluatorType: "c/two" }),
        run({ tenantId: SECOND, status: "processed", scheduledAt: SINCE, evaluatorType: "c/two" }),
      ]);

      const usage = await repository.findTypeUsageRows({ since: SINCE, until: UNTIL, limit: 2 });

      expect(usage.map((row) => [row.evaluatorType, row.runs, row.projects])).toEqual([
        ["c/two", 2, 2],
        ["a/one", 1, 1],
      ]);
    });
  });
});
