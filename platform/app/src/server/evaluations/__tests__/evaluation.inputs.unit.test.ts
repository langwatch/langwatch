import { beforeEach, describe, expect, it, vi } from "vitest";
import { ownProof } from "~/test-utils/authorizationProofs";
import {
  serviceOver,
  serviceOverUnavailable,
} from "./support/evaluationServiceOver";

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
              {
                TenantId: "project_test",
                Inputs: '{"input":"hello","output":"world"}',
              },
            ],
          }),
        );
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          authorization: ownProof({ projectId: "project_test" }),
          evaluationId: "eval-1",
        });

        expect(result).toEqual({ input: "hello", output: "world" });

        // The read must prune by the sort key (EvaluationId), never fall back
        // to a TraceId scan that can't prune granules.
        const sql = query.mock.calls[0]?.[0]?.query ?? "";
        expect(sql).toContain("EvaluationId = {evaluationId:String}");
        expect(sql).not.toContain("TraceId");
        const params = query.mock.calls[0]?.[0]?.query_params ?? {};
        expect(params).toMatchObject({ evaluationId: "eval-1" });
        // The tenant comes from the proof's fence, not from the caller.
        expect(JSON.stringify(params)).toContain("project_test");
      });
    });
  });

  describe("given the evaluation recorded no inputs", () => {
    describe("when its inputs are requested", () => {
      it("returns null", async () => {
        const query = vi.fn(async () => ({
          json: async () => [{ TenantId: "project_test", Inputs: null }],
        }));
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          authorization: ownProof({ projectId: "project_test" }),
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
          authorization: ownProof({ projectId: "project_test" }),
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("given no project the proof reads holds the evaluation", () => {
    describe("when its inputs are requested", () => {
      it("returns null", async () => {
        const query = vi.fn(async () => ({ json: async () => [] }));
        const service = serviceOver({ query });

        const result = await service.getEvaluationInputs({
          authorization: ownProof({ projectId: "project_test" }),
          evaluationId: "eval-1",
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("given ClickHouse is not enabled for the project", () => {
    describe("when its inputs are requested", () => {
      it("fails the read like any other read that cannot reach ClickHouse", async () => {
        const service = serviceOverUnavailable(
          new Error("ClickHouse not available for tenant project_test"),
        );

        await expect(
          service.getEvaluationInputs({
            authorization: ownProof({ projectId: "project_test" }),
            evaluationId: "eval-1",
          }),
        ).rejects.toThrow("Failed to fetch evaluation inputs");
      });
    });
  });
});
