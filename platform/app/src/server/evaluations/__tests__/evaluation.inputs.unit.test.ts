import { beforeEach, describe, expect, it, vi } from "vitest";

const clickHouseForProjectMock = vi.hoisted(() => vi.fn());

vi.mock("~/server/app-layer/clients/clickhouse/tenant-resolver", () => ({
  clickHouseForProject: clickHouseForProjectMock,
}));

import { EvaluationService } from "../evaluation.service";

describe("EvaluationService.getEvaluationInputs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given an evaluation with recorded inputs", () => {
    describe("when its inputs are requested", () => {
      /** @scenario A single evaluation's inputs can be fetched without scanning the trace */
      it("keys the read by EvaluationId (not TraceId) and parses the blob", async () => {
        const query = vi.fn(
          async (_args: { sql: string; params: Record<string, unknown> }) => [
            { Inputs: '{"input":"hello","output":"world"}' },
          ],
        );
        clickHouseForProjectMock.mockResolvedValue({ query });

        const service = EvaluationService.create();
        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toEqual({ input: "hello", output: "world" });

        // The read must prune by the sort key (EvaluationId), never fall back
        // to a TraceId scan that can't prune granules.
        const sql = query.mock.calls[0]?.[0]?.sql ?? "";
        expect(sql).toContain("EvaluationId = {evaluationId:String}");
        expect(sql).not.toContain("TraceId");
        expect(query.mock.calls[0]?.[0]?.params).toMatchObject({
          tenantId: "project_test",
          evaluationId: "eval-1",
        });
      });
    });
  });

  describe("given the evaluation recorded no inputs", () => {
    describe("when its inputs are requested", () => {
      it("returns null", async () => {
        const query = vi.fn(async () => [{ Inputs: null }]);
        clickHouseForProjectMock.mockResolvedValue({ query });

        const service = EvaluationService.create();
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
        clickHouseForProjectMock.mockResolvedValue({ query });

        const service = EvaluationService.create();
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
        clickHouseForProjectMock.mockResolvedValue(null);

        const service = EvaluationService.create();
        const result = await service.getEvaluationInputs({
          projectId: "project_test",
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });
});
