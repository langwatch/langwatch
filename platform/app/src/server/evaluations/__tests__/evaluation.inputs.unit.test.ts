import { beforeEach, describe, expect, it, vi } from "vitest";
import { TraceEvaluationsClickHouseRepository } from "~/server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository";
import { EvaluationService } from "../evaluation.service";

/** Stands in for the resolver the repository is constructed with. */
const resolveClient = vi.fn();

/** The service under test, reading through a real repository over a fake client. */
function serviceOver(client: unknown) {
  resolveClient.mockResolvedValue(client);
  return new EvaluationService(
    undefined,
    new TraceEvaluationsClickHouseRepository(resolveClient),
  );
}

describe("EvaluationService.getEvaluationInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an evaluation with recorded inputs", () => {
    describe("when its inputs are requested", () => {
      /** @scenario A single evaluation's inputs can be fetched without scanning the trace */
      it("keys the read by EvaluationId (not TraceId) and parses the blob", async () => {
        const query = vi.fn(
          async (_args: {
            query: string;
            query_params: Record<string, unknown>;
          }) => ({
            json: async () => [
              { Inputs: '{"input":"hello","output":"world"}' },
            ],
          }),
        );
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toEqual({ input: "hello", output: "world" });

        // The read must prune by the sort key (EvaluationId), never fall back
        // to a TraceId scan that can't prune granules.
        const sql = query.mock.calls[0]?.[0]?.query ?? "";
        expect(sql).toContain("EvaluationId = {evaluationId:String}");
        expect(sql).not.toContain("TraceId");
        expect(query.mock.calls[0]?.[0]?.query_params).toMatchObject({
          tenantId: "project_test",
          evaluationId: "eval-1",
        });
      });
    });
  });

  describe("given the evaluation recorded no inputs", () => {
    describe("when its inputs are requested", () => {
      it("returns null", async () => {
        const query = vi.fn(async () => ({
          json: async () => [{ Inputs: null }],
        }));
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("given the pruned read still exceeds the memory limit", () => {
    describe("when its inputs are requested", () => {
      it("degrades to null instead of throwing a 500", async () => {
        const query = vi.fn(async () => {
          throw new Error(
            "Query memory limit exceeded: would use 4.00 GiB, maximum: 3.50 GiB: (while reading column Inputs)",
          );
        });
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("given ClickHouse is not enabled for the project", () => {
    describe("when its inputs are requested", () => {
      it("returns null without querying", async () => {
        resolveClient.mockRejectedValue(
          new Error("ClickHouse not available for tenant project_test"),
        );
        const service = new EvaluationService(
          undefined,
          new TraceEvaluationsClickHouseRepository(resolveClient),
        );

        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });
});
