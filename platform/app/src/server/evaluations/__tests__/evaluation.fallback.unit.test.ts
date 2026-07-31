import { beforeEach, describe, expect, it, vi } from "vitest";

const clickHouseForProjectMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/app-layer/clients/clickhouse/tenant-resolver", () => ({
  clickHouseForProject: clickHouseForProjectMock,
}));

import { QueryMemoryExceededError } from "~/server/app-layer/traces/errors";
import { EvaluationService } from "../evaluation.service";

/**
 * Build a fake ClickHouse client whose `query` inspects the SQL and either
 * throws the memory-limit error (when the heavy `Inputs` column is in the
 * projection) or returns `rows` (when it isn't). Lets us assert the
 * service degrades to the light projection instead of surfacing a 500.
 *
 * `failure` is a parameter because the shape of a memory limit depends on who
 * hands it over, and the fallback has to survive both. A caller holding a raw
 * client sees the driver's own message; a caller going through the tenant
 * client sees a translated `QueryMemoryExceededError`, whose message is "Query
 * exceeded its memory limit and was aborted" and shares no substring with the
 * driver's. Testing only the first is how this fallback sat unreachable in
 * production while its tests stayed green.
 */
function clientThatOOMsOnInputs(rows: unknown[], failure: () => Error) {
  return {
    query: vi.fn(async ({ sql }: { sql: string }) => {
      if (/\bInputs\b/.test(sql)) throw failure();
      return rows;
    }),
  };
}

/** What a caller holding a raw `@clickhouse/client` sees. */
const rawDriverMemoryLimit = () =>
  new Error(
    "Query memory limit exceeded: would use 6.00 GiB (attempt to allocate chunk of 4.00 GiB), maximum: 3.50 GiB: (while reading column Inputs)",
  );

/** What the tenant client actually throws, translated, with the driver error in `reasons`. */
const translatedMemoryLimit = () =>
  new QueryMemoryExceededError({ reasons: [rawDriverMemoryLimit()] });

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
    describe("when the client reports it as the handled error it really throws", () => {
      it("retries without Inputs rather than surfacing the failure", async () => {
        const client = clientThatOOMsOnInputs([ROW], translatedMemoryLimit);
        clickHouseForProjectMock.mockResolvedValue(client);

        const service = EvaluationService.create();
        const result = await service.getEvaluationsForTrace({
          projectId: "project_test",
          traceId: "trace-1",
        });

        expect(result).toHaveLength(1);
        expect(result?.[0]?.inputs).toBeNull();
        expect(client.query).toHaveBeenCalledTimes(2);
      });
    });

    describe("when a caller holding a raw client reports the driver's own error", () => {
      it("retries without Inputs and still returns the verdicts", async () => {
        const client = clientThatOOMsOnInputs([ROW], rawDriverMemoryLimit);
        clickHouseForProjectMock.mockResolvedValue(client);

        const service = EvaluationService.create();
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
        const client = clientThatOOMsOnInputs([ROW], translatedMemoryLimit);
        clickHouseForProjectMock.mockResolvedValue(client);

        const service = EvaluationService.create();
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
