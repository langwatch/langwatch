import { beforeEach, describe, expect, it, vi } from "vitest";

const getClickHouseClientForProjectMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: getClickHouseClientForProjectMock,
}));

import { EvaluationService } from "../evaluation.service";

/**
 * Build a fake ClickHouse client whose `query` inspects the SQL and either
 * throws the memory-limit error (when the heavy `Inputs` column is in the
 * projection) or returns `rows` (when it isn't). Lets us assert the
 * service degrades to the light projection instead of surfacing a 500.
 */
function clientThatOOMsOnInputs(rows: unknown[]) {
  return {
    query: vi.fn(async ({ query }: { query: string }) => {
      if (/\bInputs\b/.test(query)) {
        throw new Error(
          "Query memory limit exceeded: would use 6.00 GiB (attempt to allocate chunk of 4.00 GiB), maximum: 3.50 GiB: (while reading column Inputs)",
        );
      }
      return { json: async () => rows };
    }),
  };
}

const ROW = {
  EvaluationId: "eval-1",
  EvaluatorId: "evaluator-1",
  EvaluatorType: "llm_boolean",
  EvaluatorName: "Toxicity",
  TraceId: "trace-1",
  IsGuardrail: 0,
  Status: "processed",
  Score: 1,
  Passed: 1,
  Label: null,
  Details: null,
  Error: null,
  ScheduledAt: null,
  StartedAt: null,
  CompletedAt: null,
};

describe("EvaluationService memory-limit fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given the Inputs column read exceeds the ClickHouse memory limit", () => {
    describe("when fetching evaluations for a single trace", () => {
      it("retries without Inputs and still returns the verdicts", async () => {
        const client = clientThatOOMsOnInputs([ROW]);
        getClickHouseClientForProjectMock.mockResolvedValue(client);

        const service = EvaluationService.create({} as never);
        const result = await service.getEvaluationsForTrace({
          projectId: "project_test",
          traceId: "trace-1",
        });

        expect(result).toHaveLength(1);
        expect(result?.[0]?.evaluationId).toBe("eval-1");
        expect(result?.[0]?.inputs).toBeNull();
        // First attempt (with Inputs) + fallback (without).
        expect(client.query).toHaveBeenCalledTimes(2);
      });
    });

    describe("when fetching evaluations for multiple traces", () => {
      it("retries without Inputs and groups the verdicts by trace", async () => {
        const client = clientThatOOMsOnInputs([ROW]);
        getClickHouseClientForProjectMock.mockResolvedValue(client);

        const service = EvaluationService.create({} as never);
        const result = await service.getEvaluationsMultiple({
          projectId: "project_test",
          traceIds: ["trace-1"],
        });

        expect(result?.["trace-1"]).toHaveLength(1);
        expect(result?.["trace-1"]?.[0]?.inputs).toBeNull();
        expect(client.query).toHaveBeenCalledTimes(2);
      });
    });
  });
});
