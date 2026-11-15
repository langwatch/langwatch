import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { describe, expect, it } from "vitest";

import { MemoryEvaluationRunRepository } from "../memory.evaluation-run.repository.ts";

const run = (evaluationId: string): EvaluationRunData => ({
  evaluationId,
  evaluatorId: "evaluator_1",
  evaluatorType: "native",
  evaluatorName: null,
  traceId: "trace_1",
  isGuardrail: false,
  status: "processed",
  score: 1,
  passed: true,
  label: null,
  details: null,
  inputs: null,
  error: null,
  errorDetails: null,
  createdAt: 1,
  updatedAt: 2,
  LastEventOccurredAt: 2,
  archivedAt: null,
  scheduledAt: 1,
  startedAt: 1,
  completedAt: 2,
  costId: null,
});

describe("MemoryEvaluationRunRepository", () => {
  describe("when the storage meter asks for stored bytes (getStoredBytes)", () => {
    it("grows with the project's held runs and counts none of another project's", async () => {
      const runs = MemoryEvaluationRunRepository.create();
      await runs.upsert({ tenantId: "project_1", data: run("evaluation_1") });
      const one = await runs.getStoredBytes({ tenantId: "project_1" });
      await runs.upsert({ tenantId: "project_1", data: run("evaluation_2") });
      await runs.upsert({ tenantId: "project_2", data: run("evaluation_3") });

      expect(one).toBeGreaterThan(0);
      expect(await runs.getStoredBytes({ tenantId: "project_1" })).toBeGreaterThan(one);
      expect(await runs.getStoredBytes({ tenantId: "project_empty" })).toBe(0);
    });
  });
});
