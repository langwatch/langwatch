import { describe, expect, it } from "vitest";
import { IdUtils } from "../id.utils";

describe("IdUtils", () => {
  describe("generateDeterministicBatchResultId", () => {
    it("generates deterministic IDs (same input = same output)", () => {
      const id1 = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );
      const id2 = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );

      expect(id1).toBe(id2);
    });

    it("generates different IDs for different inputs", () => {
      const baseArgs = [
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "target" as const,
        null,
        1000000,
      ] as const;

      const baseId = IdUtils.generateDeterministicBatchResultId(...baseArgs);

      // Different tenant
      const differentTenant = IdUtils.generateDeterministicBatchResultId(
        "tenant-2",
        "run-123",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );
      expect(differentTenant).not.toBe(baseId);

      // Different run
      const differentRun = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-456",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );
      expect(differentRun).not.toBe(baseId);

      // Different index
      const differentIndex = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        1,
        "target-1",
        "target",
        null,
        1000000,
      );
      expect(differentIndex).not.toBe(baseId);

      // Different target
      const differentTarget = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-2",
        "target",
        null,
        1000000,
      );
      expect(differentTarget).not.toBe(baseId);
    });

    it("generates different IDs for target vs evaluator results", () => {
      const targetId = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );

      const evaluatorId = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "evaluator",
        "eval-1",
        1000000,
      );

      expect(targetId).not.toBe(evaluatorId);
    });

    it("generates different IDs for different evaluators", () => {
      const eval1Id = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "evaluator",
        "eval-1",
        1000000,
      );

      const eval2Id = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "evaluator",
        "eval-2",
        1000000,
      );

      expect(eval1Id).not.toBe(eval2Id);
    });

    it("returns a string ID", () => {
      const id = IdUtils.generateDeterministicBatchResultId(
        "tenant-1",
        "run-123",
        0,
        "target-1",
        "target",
        null,
        1000000,
      );

      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    });
  });
});
