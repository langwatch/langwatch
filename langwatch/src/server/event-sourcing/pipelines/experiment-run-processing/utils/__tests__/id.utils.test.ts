import { describe, expect, it } from "vitest";
import { IdUtils } from "../id.utils";

describe("IdUtils", () => {
  describe("generateDeterministicResultId", () => {
    const baseParams = {
      tenantId: "tenant-1",
      runId: "run-123",
      index: 0,
      targetId: "target-1",
      resultType: "target" as const,
      evaluatorId: null,
    };

    it("generates deterministic IDs (same input = same output)", () => {
      const id1 = IdUtils.generateDeterministicResultId(baseParams);
      const id2 = IdUtils.generateDeterministicResultId(baseParams);

      expect(id1).toBe(id2);
    });

    it("generates different IDs for different inputs", () => {
      const baseId = IdUtils.generateDeterministicResultId(baseParams);

      // Different tenant
      const differentTenant = IdUtils.generateDeterministicResultId({
        ...baseParams,
        tenantId: "tenant-2",
      });
      expect(differentTenant).not.toBe(baseId);

      // Different run
      const differentRun = IdUtils.generateDeterministicResultId({
        ...baseParams,
        runId: "run-456",
      });
      expect(differentRun).not.toBe(baseId);

      // Different index
      const differentIndex = IdUtils.generateDeterministicResultId({
        ...baseParams,
        index: 1,
      });
      expect(differentIndex).not.toBe(baseId);

      // Different target
      const differentTarget = IdUtils.generateDeterministicResultId({
        ...baseParams,
        targetId: "target-2",
      });
      expect(differentTarget).not.toBe(baseId);
    });

    it("generates different IDs for target vs evaluator results", () => {
      const targetId = IdUtils.generateDeterministicResultId(baseParams);

      const evaluatorId = IdUtils.generateDeterministicResultId({
        ...baseParams,
        resultType: "evaluator",
        evaluatorId: "eval-1",
      });

      expect(targetId).not.toBe(evaluatorId);
    });

    it("generates different IDs for different evaluators", () => {
      const eval1Id = IdUtils.generateDeterministicResultId({
        ...baseParams,
        resultType: "evaluator",
        evaluatorId: "eval-1",
      });

      const eval2Id = IdUtils.generateDeterministicResultId({
        ...baseParams,
        resultType: "evaluator",
        evaluatorId: "eval-2",
      });

      expect(eval1Id).not.toBe(eval2Id);
    });

    it("returns a string ID", () => {
      const id = IdUtils.generateDeterministicResultId(baseParams);

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });

    it("throws when evaluator result has no evaluatorId", () => {
      expect(() =>
        IdUtils.generateDeterministicResultId({
          ...baseParams,
          resultType: "evaluator",
          evaluatorId: null,
        }),
      ).toThrow("evaluatorId is required for evaluator results");
    });

    it("throws when target result has an evaluatorId", () => {
      expect(() =>
        IdUtils.generateDeterministicResultId({
          ...baseParams,
          resultType: "target",
          evaluatorId: "eval-1",
        }),
      ).toThrow("evaluatorId must be null for target results");
    });
  });
});
