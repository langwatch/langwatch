/**
 * The in-memory evaluation runs answer a proof as the ClickHouse read does (ADR-175): the own
 * project outright, a member inside its grant's window on `scheduledAt`, an outsider never.
 */
import { aggregateProof } from "@langwatch/authorization/testing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceEvaluationRunsRepository } from "../memory.trace-evaluation-runs.repository.ts";

const NOW = 1_760_000_000_000;

function run({
  tenantId,
  traceId,
  scheduledAt = NOW,
}: {
  tenantId: string;
  traceId: string;
  scheduledAt?: number;
}): EvaluationRunData & { tenantId: string } {
  return {
    tenantId,
    evaluationId: `eval-${tenantId}-${traceId}-${scheduledAt}`,
    evaluatorId: "evaluator-1",
    evaluatorType: "test/evaluator",
    evaluatorName: `evaluator-of-${tenantId}`,
    traceId,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: null,
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: scheduledAt,
    updatedAt: scheduledAt,
    LastEventOccurredAt: scheduledAt,
    archivedAt: null,
    scheduledAt,
    startedAt: scheduledAt,
    completedAt: scheduledAt,
    costId: null,
  };
}

const repository = MemoryTraceEvaluationRunsRepository.create({
  runs: [
    run({ tenantId: "member-a", traceId: "trace-a" }),
    run({ tenantId: "member-a", traceId: "trace-a", scheduledAt: NOW - 10_000 }),
    run({ tenantId: "outsider", traceId: "trace-a" }),
    run({ tenantId: "aggregate", traceId: "trace-own" }),
  ],
});

const authorization = aggregateProof({
  projectId: "aggregate",
  members: [{ projectId: "member-a", from: NOW - 1_000 }],
  now: NOW,
});

describe("MemoryTraceEvaluationRunsRepository", () => {
  describe("given a proof over an aggregate and a member whose grant opens just before now", () => {
    it("reads the member's run inside the window and never the outsider's", async () => {
      const runs = await repository.findRunsByTraceId({ authorization, traceId: "trace-a" });
      const summaries = await repository.findSummariesByTraceIds({
        authorization,
        traceIds: ["trace-a", "trace-own"],
        since: 0,
      });
      const evaluations = await repository.findTraceEvaluations({
        authorization,
        traceIds: ["trace-a"],
      });

      expect(runs.map((found) => found.scheduledAt)).toEqual([NOW]);
      expect(summaries["trace-a"]?.map((summary) => summary.evaluatorName)).toEqual([
        "evaluator-of-member-a",
      ]);
      expect(summaries["trace-own"]).toHaveLength(1);
      expect(evaluations["trace-a"]).toHaveLength(1);
    });
  });
});
