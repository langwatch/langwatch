/** @vitest-environment node */
/** Spec: specs/evaluations/trace-evaluations-read.feature */
import { describe, expect, it, vi } from "vitest";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository";

const TENANT = "tenant_1";

function build(rows: Record<string, unknown>[]) {
  const query = vi.fn(async () => ({ json: async () => rows }));
  const repository = EvaluationRunClickHouseReadRepository.create({
    resolveClient: async () => ({ query }) as never,
    retentionFloor: { getFloorMs: async () => 0 },
  });
  return { repository, query };
}

describe("EvaluationRunClickHouseReadRepository.findTraceEvaluations", () => {
  describe("when a trace carries an evaluation with all three times set", () => {
    /** @scenario "A trace whose evaluation has landed still reads" */
    it("selects the times as milliseconds and reads them back as numbers", async () => {
      const { repository, query } = build([
        {
          EvaluationId: "eval_1",
          EvaluatorId: "evaluator_1",
          EvaluatorType: "langevals/basic",
          EvaluatorName: "Basic",
          TraceId: "trace_1",
          IsGuardrail: 0,
          Status: "processed",
          Score: 0.5,
          Passed: 1,
          Label: null,
          Details: null,
          Error: null,
          Inputs: null,
          ScheduledAt: 1_757_000_000_000,
          StartedAt: 1_757_000_001_000,
          CompletedAt: 1_757_000_002_000,
        },
      ]);

      const result = await repository.findTraceEvaluations({ tenantId: TENANT, traceIds: ["trace_1"] });

      const sql = String((query.mock.calls[0]?.[0] as { query: string }).query);
      for (const column of ["ScheduledAt", "StartedAt", "CompletedAt"]) {
        expect(sql).toContain(`toUnixTimestamp64Milli(runs.${column}) AS ${column}`);
      }
      expect(result.trace_1?.[0]?.timestamps).toEqual({
        scheduledAt: 1_757_000_000_000,
        startedAt: 1_757_000_001_000,
        completedAt: 1_757_000_002_000,
      });
    });
  });
});
